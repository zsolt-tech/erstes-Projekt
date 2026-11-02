// Google Calendar: Zwei-Wege-Abgleich und Kalenderansicht der App.
//
// Richtung App -> Google: Aus der Datenbank wird berechnet, welche Termine in Google stehen sollen
// (Drehtage immer, optional Freigabe-Fristen und Veröffentlichungen). Eine Prüfsumme je Termin
// verhindert unnötige Aktualisierungen.
// Richtung Google -> App: Inkrementeller Abgleich mit Sync-Token. Werden App-Termine in Google
// verschoben, übernimmt die App Datum, Uhrzeit und Ort. Bei gleichzeitiger Änderung gewinnt die jüngere.
import crypto from 'node:crypto';
import type { Database } from '../db/database.ts';
import type { AppConfig } from '../env.ts';
import { HttpError } from '../lib/http.ts';
import { events } from '../lib/events.ts';
import { addDays, berlinParts, nowIso, todayBerlin, TIME_ZONE } from '../lib/time.ts';
import { getSetting, getSettings, setSetting } from '../services/settings.ts';
import { GoogleApiError, type GoogleClient } from './client.ts';
import type { SyncQueue } from './queue.ts';
import {
  PHASE_LABELS,
  PLATFORM_LABELS,
  type CalendarInfo,
  type CalendarItem,
  type CalendarSettings,
  type Phase,
  type Platform,
  type ShootCalendar,
} from '../../shared/schemas.ts';

type LinkedType = 'shoot' | 'approval' | 'publication';

interface Desired {
  linked_type: LinkedType;
  linked_id: number;
  summary: string;
  description: string;
  location: string | null;
  all_day: boolean;
  start: string; // YYYY-MM-DD oder YYYY-MM-DDTHH:MM (Berlin)
  end: string;
  color: string;
  hash: string;
}

interface GEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GEvent {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GEventTime;
  end?: GEventTime;
  updated?: string;
  etag?: string;
  htmlLink?: string;
  extendedProperties?: { private?: Record<string, string> };
}

interface EventRow {
  id: number;
  start_at: string | null;
  google_calendar_id: string;
  google_event_id: string;
  source: 'google' | 'app';
  linked_type: LinkedType | null;
  linked_id: number | null;
  status: string | null;
  content_hash: string | null;
  google_updated_at: string | null;
  synced_at: string | null;
  html_link: string | null;
}

// Google-Kalenderfarben passend zur App: Drehtag blau, Freigabe violett, Veröffentlichung grün
const GOOGLE_COLOR: Record<LinkedType, string> = { shoot: '9', approval: '3', publication: '10' };
const DAY_MS = 86400000;

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-10T09:00" plus Minuten, ohne Zeitzonenumrechnung (Ortszeit) */
function addMinutesLocal(local: string, minutes: number): string {
  const d = new Date(`${local}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 16);
}

/** Google-Zeitpunkt in Berliner Ortszeit "YYYY-MM-DDTHH:MM" */
function toBerlinLocal(dateTime: string): string {
  const p = berlinParts(new Date(dateTime));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function hashOf(d: Omit<Desired, 'hash'>): string {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify([d.summary, d.description, d.location, d.all_day, d.start, d.end, d.color]))
    .digest('hex');
}

export class CalendarService {
  private syncTimer: NodeJS.Timeout | null = null;

  constructor(
    private db: Database,
    private config: AppConfig,
    private google: GoogleClient,
    private queue: SyncQueue,
  ) {
    queue.register('calendar.sync', async () => {
      await this.sync();
    });
  }

  // ---------------------------------------------------------------------
  // Einstellungen
  // ---------------------------------------------------------------------

  private writeId(): string {
    return getSetting<string>(this.db, 'calendar_write_id', 'primary');
  }

  private pushFlags() {
    return {
      approvals: getSetting<boolean>(this.db, 'calendar_push_approvals', false),
      publications: getSetting<boolean>(this.db, 'calendar_push_publications', false),
    };
  }

  private readIds(): string[] {
    return this.db
      .all<{ google_calendar_id: string }>('SELECT google_calendar_id FROM calendar_sync_state WHERE read_enabled = 1')
      .map((r) => r.google_calendar_id);
  }

  /** Kalenderliste von Google holen und lokal merken; der Hauptkalender wird beim ersten Mal gelesen */
  async refreshCalendarList(): Promise<void> {
    const res = await this.google.request<{
      items: { id: string; summary: string; primary?: boolean; accessRole: string; backgroundColor?: string; summaryOverride?: string }[];
    }>('GET', '/calendar/v3/users/me/calendarList', { query: { maxResults: '250' } });
    const primary = res.items.find((c) => c.primary);
    this.db.transaction(() => {
      for (const c of res.items) {
        this.db.run(
          `INSERT INTO calendar_sync_state (google_calendar_id, name, read_enabled, color, access_role)
           VALUES (:id, :name, :read, :color, :role)
           ON CONFLICT(google_calendar_id) DO UPDATE SET name = excluded.name, color = excluded.color, access_role = excluded.access_role`,
          { id: c.id, name: c.summaryOverride ?? c.summary, read: c.primary ? 1 : 0, color: c.backgroundColor ?? null, role: c.accessRole },
        );
      }
      // Kalender, die es nicht mehr gibt, entfernen
      const ids = new Set(res.items.map((c) => c.id));
      for (const r of this.db.all<{ google_calendar_id: string }>('SELECT google_calendar_id FROM calendar_sync_state')) {
        if (!ids.has(r.google_calendar_id)) {
          this.db.run('DELETE FROM calendar_sync_state WHERE google_calendar_id = ?', [r.google_calendar_id]);
          this.db.run("DELETE FROM calendar_events WHERE google_calendar_id = ? AND source = 'google'", [r.google_calendar_id]);
        }
      }
      // "primary" durch die echte Kennung ersetzen, damit Einträge eindeutig zugeordnet sind
      if (primary && this.writeId() === 'primary') setSetting(this.db, 'calendar_write_id', primary.id);
    });
  }

  settings(): CalendarSettings {
    const rows = this.db.all<{ google_calendar_id: string; name: string; color: string | null; access_role: string | null; read_enabled: number }>(
      'SELECT google_calendar_id, name, color, access_role, read_enabled FROM calendar_sync_state ORDER BY name COLLATE NOCASE',
    );
    const writeId = this.writeId();
    const calendars: CalendarInfo[] = rows.map((r) => ({
      id: r.google_calendar_id,
      name: r.name,
      color: r.color,
      primary: r.access_role === 'owner' && r.google_calendar_id === writeId,
      access_role: r.access_role,
      read_enabled: !!r.read_enabled,
    }));
    const flags = this.pushFlags();
    return {
      connected: this.google.connected,
      calendars,
      write_id: writeId,
      push_approvals: flags.approvals,
      push_publications: flags.publications,
      last_sync_at: getSetting<string | null>(this.db, 'calendar_last_sync', null),
      last_error: getSetting<string | null>(this.db, 'calendar_last_error', null),
    };
  }

  updateSettings(data: { write_id: string; read_ids: string[]; push_approvals: boolean; push_publications: boolean }): CalendarSettings {
    const known = this.db.get<{ access_role: string | null }>('SELECT access_role FROM calendar_sync_state WHERE google_calendar_id = ?', [data.write_id]);
    if (!known) throw new HttpError(400, 'Unbekannter Kalender');
    if (known.access_role !== 'owner' && known.access_role !== 'writer') {
      throw new HttpError(400, 'In diesen Kalender darf die App nicht schreiben. Bitte einen eigenen Kalender wählen.');
    }
    this.db.transaction(() => {
      setSetting(this.db, 'calendar_write_id', data.write_id);
      setSetting(this.db, 'calendar_push_approvals', data.push_approvals);
      setSetting(this.db, 'calendar_push_publications', data.push_publications);
      this.db.run('UPDATE calendar_sync_state SET read_enabled = 0');
      for (const id of data.read_ids) this.db.run('UPDATE calendar_sync_state SET read_enabled = 1 WHERE google_calendar_id = ?', [id]);
      // Nicht mehr gelesene Kalender: fremde Termine lokal entfernen, Sync-Token zurücksetzen
      this.db.run(
        `DELETE FROM calendar_events WHERE source = 'google' AND google_calendar_id IN
           (SELECT google_calendar_id FROM calendar_sync_state WHERE read_enabled = 0)`,
      );
      this.db.run('UPDATE calendar_sync_state SET sync_token = NULL WHERE read_enabled = 0');
    });
    this.requestSync(0);
    return this.settings();
  }

  // ---------------------------------------------------------------------
  // Abgleich anstoßen
  // ---------------------------------------------------------------------

  /** Abgleich nach Änderungen in der App, kurz gesammelt */
  requestSync(delayMs = 2000) {
    if (!this.google.connected) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.queue.enqueue('calendar.sync', { label: 'Kalender abgleichen' });
    }, delayMs);
    this.syncTimer.unref?.();
  }

  /** Vollständiger Abgleich: erst Änderungen aus Google holen, dann App-Termine übertragen */
  async sync(): Promise<void> {
    try {
      if (!this.db.get('SELECT 1 FROM calendar_sync_state LIMIT 1') || this.writeId() === 'primary') {
        await this.refreshCalendarList();
      }
      const calendars = new Set([...this.readIds(), this.writeId()]);
      for (const id of calendars) await this.pull(id);
      await this.push();
      setSetting(this.db, 'calendar_last_sync', nowIso());
      setSetting(this.db, 'calendar_last_error', null);
    } catch (err) {
      setSetting(this.db, 'calendar_last_error', err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      events.changed('calendar');
    }
  }

  // ---------------------------------------------------------------------
  // App -> Google
  // ---------------------------------------------------------------------

  private appUrl(path: string) {
    return `http://localhost:${this.config.port}${path}`;
  }

  /** Alle Termine, die laut Datenbank in Google stehen sollen */
  desiredEvents(): Desired[] {
    const out: Desired[] = [];
    // Ältere Termine werden weder angelegt noch geändert oder gelöscht
    const cutoff = this.cutoff();
    const add = (d: Omit<Desired, 'hash'>) => out.push({ ...d, hash: hashOf(d) });
    const flags = this.pushFlags();

    for (const s of this.db.all<{
      project_id: number;
      title: string;
      company_name: string;
      shoot_date: string;
      start_time: string | null;
      end_time: string | null;
      location: string | null;
      location_notes: string | null;
      shotlist_notes: string | null;
    }>(
      `SELECT s.project_id, p.title, c.company_name, s.shoot_date, s.start_time, s.end_time, s.location, s.location_notes, s.shotlist_notes
       FROM shoots s JOIN projects p ON p.id = s.project_id JOIN customers c ON c.id = p.customer_id
       WHERE s.shoot_date >= ? AND p.status IN ('aktiv','pausiert','abgeschlossen')`,
      [cutoff],
    )) {
      const shots = this.db
        .all<{ label: string }>("SELECT label FROM checklist_items WHERE project_id = ? AND kind = 'shot' ORDER BY sort_order, id", [s.project_id])
        .map((r) => `- ${r.label}`);
      const description = [
        s.location_notes ? `Hinweise vor Ort: ${s.location_notes}` : null,
        shots.length ? `Shotlist:\n${shots.join('\n')}` : null,
        s.shotlist_notes,
        `Projekt in der Agentur-App: ${this.appUrl(`/projekte/${s.project_id}`)}`,
      ]
        .filter(Boolean)
        .join('\n\n');
      const timed = !!s.start_time;
      const start = timed ? `${s.shoot_date}T${s.start_time}` : s.shoot_date;
      let end = timed ? (s.end_time && s.end_time > s.start_time! ? `${s.shoot_date}T${s.end_time}` : addMinutesLocal(start, 120)) : addDays(s.shoot_date, 1);
      if (timed && end <= start) end = addMinutesLocal(start, 60);
      add({
        linked_type: 'shoot',
        linked_id: s.project_id,
        summary: `Drehtag: ${s.company_name} – ${s.title}`,
        description,
        location: s.location,
        all_day: !timed,
        start,
        end,
        color: GOOGLE_COLOR.shoot,
      });
    }

    if (flags.approvals) {
      for (const a of this.approvalDeadlines()) {
        add({
          linked_type: 'approval',
          linked_id: a.project_id,
          summary: `Freigabe-Frist: ${a.company_name} – ${a.title}`,
          description: `Freigabe angefragt am ${a.requested_date.split('-').reverse().join('.')}. Projekt: ${this.appUrl(`/projekte/${a.project_id}`)}`,
          location: null,
          all_day: true,
          start: a.deadline,
          end: addDays(a.deadline, 1),
          color: GOOGLE_COLOR.approval,
        });
      }
    }

    if (flags.publications) {
      for (const p of this.db.all<{ id: number; project_id: number; title: string; company_name: string; platform: Platform; planned_date: string; planned_time: string | null; caption: string | null }>(
        `SELECT pu.id, pu.project_id, p.title, c.company_name, pu.platform, pu.planned_date, pu.planned_time, pu.caption
         FROM publications pu JOIN projects p ON p.id = pu.project_id JOIN customers c ON c.id = p.customer_id
         WHERE pu.planned_date >= ? AND p.status <> 'abgebrochen'`,
        [cutoff],
      )) {
        const timed = !!p.planned_time;
        const start = timed ? `${p.planned_date}T${p.planned_time}` : p.planned_date;
        add({
          linked_type: 'publication',
          linked_id: p.id,
          summary: `Veröffentlichung ${PLATFORM_LABELS[p.platform]}: ${p.company_name} – ${p.title}`,
          description: [p.caption, `Projekt: ${this.appUrl(`/projekte/${p.project_id}`)}`].filter(Boolean).join('\n\n'),
          location: null,
          all_day: !timed,
          start,
          end: timed ? addMinutesLocal(start, 30) : addDays(p.planned_date, 1),
          color: GOOGLE_COLOR.publication,
        });
      }
    }
    return out;
  }

  private cutoff(): string {
    return addDays(todayBerlin(), -60);
  }

  private approvalDeadlines() {
    const defaultDays = getSettings(this.db).approval_reminder_days;
    return this.db
      .all<{ project_id: number; title: string; company_name: string; requested_at: string; days: number | null }>(
        `SELECT p.id AS project_id, p.title, c.company_name, ar.requested_at,
                COALESCE(p.approval_reminder_days, c.approval_reminder_days) AS days
         FROM approval_rounds ar JOIN projects p ON p.id = ar.project_id JOIN customers c ON c.id = p.customer_id
         WHERE ar.responded_at IS NULL AND p.current_phase = 4 AND p.status = 'aktiv'`,
      )
      .map((a) => {
        const requested = todayBerlin(new Date(a.requested_at));
        return { ...a, requested_date: requested, deadline: addDays(requested, a.days ?? defaultDays) };
      });
  }

  private toGoogle(d: Desired) {
    const time = (v: string): GEventTime => (d.all_day ? { date: v } : { dateTime: `${v}:00`, timeZone: TIME_ZONE });
    return {
      summary: d.summary,
      description: d.description,
      location: d.location ?? '',
      start: time(d.start),
      end: time(d.end),
      colorId: d.color,
      extendedProperties: { private: { agenturApp: '1', linkedType: d.linked_type, linkedId: String(d.linked_id) } },
    };
  }

  private saveAppRow(calendarId: string, ev: GEvent, d: Desired, rowId?: number) {
    const values = {
      cal: calendarId,
      gid: ev.id,
      etag: ev.etag ?? null,
      title: ev.summary ?? d.summary,
      description: ev.description ?? null,
      location: ev.location ?? null,
      start: d.start,
      end: d.end,
      allday: d.all_day,
      status: ev.status ?? 'confirmed',
      link: ev.htmlLink ?? null,
      updated: ev.updated ?? nowIso(),
      type: d.linked_type,
      lid: d.linked_id,
      hash: d.hash,
      now: nowIso(),
    };
    if (rowId) {
      this.db.run(
        `UPDATE calendar_events SET google_calendar_id = :cal, google_event_id = :gid, etag = :etag, title = :title,
           description = :description, location = :location, start_at = :start, end_at = :end, all_day = :allday,
           status = :status, html_link = :link, google_updated_at = :updated, content_hash = :hash, synced_at = :now
         WHERE id = :rid`,
        { ...values, rid: rowId },
      );
    } else {
      this.db.run(
        `INSERT INTO calendar_events (google_calendar_id, google_event_id, etag, title, description, location, start_at, end_at,
           all_day, status, html_link, google_updated_at, source, linked_type, linked_id, content_hash, synced_at)
         VALUES (:cal, :gid, :etag, :title, :description, :location, :start, :end, :allday, :status, :link, :updated, 'app',
           :type, :lid, :hash, :now)
         ON CONFLICT(google_calendar_id, google_event_id) DO UPDATE SET source = 'app', linked_type = excluded.linked_type,
           linked_id = excluded.linked_id, content_hash = excluded.content_hash, status = excluded.status,
           start_at = excluded.start_at, end_at = excluded.end_at, all_day = excluded.all_day, title = excluded.title,
           google_updated_at = excluded.google_updated_at, synced_at = excluded.synced_at`,
        values,
      );
    }
  }

  private async insertEvent(calendarId: string, d: Desired): Promise<GEvent> {
    return this.google.request<GEvent>('POST', `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, { body: this.toGoogle(d) });
  }

  private async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.google.request('DELETE', `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    } catch (err) {
      if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
      throw err;
    }
  }

  /** Überträgt neue, geänderte und entfallene App-Termine nach Google */
  async push(): Promise<{ created: number; updated: number; deleted: number }> {
    const writeId = this.writeId();
    const desired = this.desiredEvents();
    const rows = this.db.all<EventRow>("SELECT * FROM calendar_events WHERE source = 'app'");
    const byKey = new Map<string, EventRow>();
    for (const r of rows) byKey.set(`${r.linked_type}:${r.linked_id}`, r);
    const stats = { created: 0, updated: 0, deleted: 0 };

    for (const d of desired) {
      const key = `${d.linked_type}:${d.linked_id}`;
      const row = byKey.get(key);
      byKey.delete(key);
      if (!row) {
        this.saveAppRow(writeId, await this.insertEvent(writeId, d), d);
        stats.created++;
        continue;
      }
      if (row.google_calendar_id !== writeId) {
        // Zielkalender gewechselt: im neuen Kalender anlegen, im alten entfernen
        if (row.status !== 'cancelled') await this.deleteEvent(row.google_calendar_id, row.google_event_id);
        this.saveAppRow(writeId, await this.insertEvent(writeId, d), d, row.id);
        stats.created++;
        continue;
      }
      if (row.status === 'cancelled') {
        // In Google gelöscht: nur neu anlegen, wenn sich in der App seitdem etwas geändert hat
        if (row.content_hash === d.hash) continue;
        this.saveAppRow(writeId, await this.insertEvent(writeId, d), d, row.id);
        stats.created++;
        continue;
      }
      if (row.content_hash === d.hash) continue;
      try {
        const ev = await this.google.request<GEvent>(
          'PATCH',
          `/calendar/v3/calendars/${encodeURIComponent(writeId)}/events/${encodeURIComponent(row.google_event_id)}`,
          { body: this.toGoogle(d) },
        );
        this.saveAppRow(writeId, ev, d, row.id);
        stats.updated++;
      } catch (err) {
        if (!(err instanceof GoogleApiError && (err.status === 404 || err.status === 410))) throw err;
        this.saveAppRow(writeId, await this.insertEvent(writeId, d), d, row.id);
        stats.created++;
      }
    }

    // Entfallene Termine (Drehtag entfernt, Projekt gelöscht oder abgebrochen, Option abgeschaltet)
    const cutoff = this.cutoff();
    for (const row of byKey.values()) {
      if (row.start_at && row.start_at.slice(0, 10) < cutoff) continue; // Vergangenes bleibt stehen
      if (row.status !== 'cancelled') await this.deleteEvent(row.google_calendar_id, row.google_event_id);
      this.db.run('DELETE FROM calendar_events WHERE id = ?', [row.id]);
      stats.deleted++;
    }
    if (stats.created || stats.updated || stats.deleted) events.changed('calendar');
    return stats;
  }

  // ---------------------------------------------------------------------
  // Google -> App
  // ---------------------------------------------------------------------

  async pull(calendarId: string): Promise<number> {
    const state = this.db.get<{ sync_token: string | null }>('SELECT sync_token FROM calendar_sync_state WHERE google_calendar_id = ?', [calendarId]);
    let syncToken = state?.sync_token ?? null;
    let pageToken: string | undefined;
    let changed = 0;
    for (let guard = 0; guard < 100; guard++) {
      const query: Record<string, string> = { singleEvents: 'true', showDeleted: 'true', maxResults: '250' };
      if (pageToken) query.pageToken = pageToken;
      if (syncToken) query.syncToken = syncToken;
      else query.timeMin = new Date(Date.now() - 60 * DAY_MS).toISOString();
      let res: { items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string };
      try {
        res = await this.google.request('GET', `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, { query });
      } catch (err) {
        if (err instanceof GoogleApiError && err.status === 410 && syncToken) {
          // Sync-Token abgelaufen: vollständig neu laden
          this.db.run("DELETE FROM calendar_events WHERE google_calendar_id = ? AND source = 'google'", [calendarId]);
          syncToken = null;
          pageToken = undefined;
          continue;
        }
        throw err;
      }
      for (const ev of res.items ?? []) {
        if (this.applyEvent(calendarId, ev)) changed++;
      }
      if (res.nextPageToken) {
        pageToken = res.nextPageToken;
        continue;
      }
      this.db.run(
        `INSERT INTO calendar_sync_state (google_calendar_id, name, sync_token, last_sync_at) VALUES (:id, :id, :token, :now)
         ON CONFLICT(google_calendar_id) DO UPDATE SET sync_token = excluded.sync_token, last_sync_at = excluded.last_sync_at`,
        { id: calendarId, token: res.nextSyncToken ?? null, now: nowIso() },
      );
      break;
    }
    if (changed) events.changed('calendar');
    return changed;
  }

  private times(ev: GEvent): { start: string; end: string; all_day: boolean } {
    if (ev.start?.date) return { start: ev.start.date, end: ev.end?.date ?? addDays(ev.start.date, 1), all_day: true };
    const start = ev.start?.dateTime ? new Date(ev.start.dateTime).toISOString() : nowIso();
    const end = ev.end?.dateTime ? new Date(ev.end.dateTime).toISOString() : start;
    return { start, end, all_day: false };
  }

  /** Übernimmt einen Termin aus Google. Gibt true zurück, wenn sich lokal etwas geändert hat. */
  private applyEvent(calendarId: string, ev: GEvent): boolean {
    const priv = ev.extendedProperties?.private ?? {};
    const isApp = priv.agenturApp === '1';
    const row = this.db.get<EventRow>('SELECT * FROM calendar_events WHERE google_calendar_id = ? AND google_event_id = ?', [calendarId, ev.id]);

    if (ev.status === 'cancelled') {
      if (!row) return false;
      if (row.source === 'app') {
        // In Google gelöscht: Projekt bleibt, Hinweis in der App
        this.db.run("UPDATE calendar_events SET status = 'cancelled', synced_at = ? WHERE id = ?", [nowIso(), row.id]);
        if (row.linked_type === 'shoot') events.changed('projects', row.linked_id ?? undefined);
      } else {
        this.db.run('DELETE FROM calendar_events WHERE id = ?', [row.id]);
      }
      return true;
    }

    const t = this.times(ev);
    if (isApp) {
      const linkedType = priv.linkedType as LinkedType;
      const linkedId = Number(priv.linkedId);
      if (!row) {
        // Unbekannter App-Termin (z. B. nach Wiederherstellung): übernehmen, falls es noch keinen gibt
        const other = this.db.get<{ id: number }>("SELECT id FROM calendar_events WHERE source = 'app' AND linked_type = ? AND linked_id = ?", [linkedType, linkedId]);
        if (other) return false;
        this.db.run(
          `INSERT INTO calendar_events (google_calendar_id, google_event_id, etag, title, start_at, end_at, all_day, status, html_link,
             google_updated_at, source, linked_type, linked_id, content_hash, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app', ?, ?, NULL, ?)`,
          [calendarId, ev.id, ev.etag ?? null, ev.summary ?? '', t.start, t.end, t.all_day ? 1 : 0, ev.status, ev.htmlLink ?? null, ev.updated ?? null, linkedType, linkedId, nowIso()],
        );
        return true;
      }
      // Eigene Änderung, die wir gerade übertragen haben: nichts zu tun
      if (row.google_updated_at && ev.updated && ev.updated <= row.google_updated_at) return false;
      const applied = this.applyGoogleChange(linkedType, linkedId, ev, row);
      this.db.run(
        `UPDATE calendar_events SET etag = ?, title = ?, location = ?, start_at = ?, end_at = ?, all_day = ?, status = ?,
           html_link = ?, google_updated_at = ?, synced_at = ? WHERE id = ?`,
        [ev.etag ?? null, ev.summary ?? '', ev.location ?? null, t.start, t.end, t.all_day ? 1 : 0, ev.status, ev.htmlLink ?? null, ev.updated ?? null, nowIso(), row.id],
      );
      if (applied) {
        // Neue Prüfsumme merken, damit der übernommene Stand nicht zurückgeschrieben wird
        const d = this.desiredEvents().find((x) => x.linked_type === linkedType && x.linked_id === linkedId);
        if (d) this.db.run('UPDATE calendar_events SET content_hash = ? WHERE id = ?', [d.hash, row.id]);
      }
      return true;
    }

    // Fremder Termin: nur aus Kalendern, die gelesen werden
    const read = this.db.get('SELECT 1 FROM calendar_sync_state WHERE google_calendar_id = ? AND read_enabled = 1', [calendarId]);
    if (!read) return false;
    this.db.run(
      `INSERT INTO calendar_events (google_calendar_id, google_event_id, etag, title, description, location, start_at, end_at,
         all_day, status, html_link, google_updated_at, source, synced_at)
       VALUES (:cal, :gid, :etag, :title, :description, :location, :start, :end, :allday, :status, :link, :updated, 'google', :now)
       ON CONFLICT(google_calendar_id, google_event_id) DO UPDATE SET etag = excluded.etag, title = excluded.title,
         description = excluded.description, location = excluded.location, start_at = excluded.start_at, end_at = excluded.end_at,
         all_day = excluded.all_day, status = excluded.status, html_link = excluded.html_link,
         google_updated_at = excluded.google_updated_at, synced_at = excluded.synced_at`,
      {
        cal: calendarId,
        gid: ev.id,
        etag: ev.etag ?? null,
        title: ev.summary ?? '(ohne Titel)',
        description: ev.description ?? null,
        location: ev.location ?? null,
        start: t.start,
        end: t.end,
        allday: t.all_day,
        status: ev.status,
        link: ev.htmlLink ?? null,
        updated: ev.updated ?? null,
        now: nowIso(),
      },
    );
    return true;
  }

  /** In Google verschobener App-Termin: Datum, Uhrzeit und Ort übernehmen, wenn die Google-Änderung jünger ist */
  private applyGoogleChange(type: LinkedType, id: number, ev: GEvent, row: EventRow): boolean {
    const googleTime = ev.updated ?? nowIso();
    const allDay = !!ev.start?.date;
    const startLocal = allDay ? ev.start!.date! : ev.start?.dateTime ? toBerlinLocal(ev.start.dateTime) : null;
    const endLocal = allDay ? null : ev.end?.dateTime ? toBerlinLocal(ev.end.dateTime) : null;
    if (!startLocal) return false;

    if (type === 'shoot') {
      const s = this.db.get<{ updated_at: string | null }>('SELECT updated_at FROM shoots WHERE project_id = ?', [id]);
      if (!s) return false;
      // Auch in der App seit dem letzten Abgleich geändert: die jüngere Änderung gewinnt
      if (s.updated_at && row.synced_at && s.updated_at > row.synced_at && s.updated_at > googleTime) return false;
      const date = startLocal.slice(0, 10);
      const sameDayEnd = endLocal && endLocal.slice(0, 10) === date ? endLocal.slice(11, 16) : null;
      this.db.run(
        'UPDATE shoots SET shoot_date = :date, start_time = :start, end_time = :end, location = :location, updated_at = :now WHERE project_id = :id',
        {
          id,
          date,
          start: allDay ? null : startLocal.slice(11, 16),
          end: allDay ? null : sameDayEnd,
          location: ev.location ?? null,
          now: googleTime,
        },
      );
      this.db.run('UPDATE project_phases SET due_date = ? WHERE project_id = ? AND phase = 1', [date, id]);
      events.changed('projects', id);
      return true;
    }
    if (type === 'publication') {
      const p = this.db.get<{ updated_at: string | null; project_id: number }>('SELECT updated_at, project_id FROM publications WHERE id = ?', [id]);
      if (!p) return false;
      if (p.updated_at && row.synced_at && p.updated_at > row.synced_at && p.updated_at > googleTime) return false;
      this.db.run('UPDATE publications SET planned_date = ?, planned_time = ?, updated_at = ? WHERE id = ?', [
        startLocal.slice(0, 10),
        allDay ? null : startLocal.slice(11, 16),
        googleTime,
        id,
      ]);
      events.changed('projects', p.project_id);
      return true;
    }
    // Freigabe-Fristen ergeben sich aus dem Anfragedatum und werden nicht zurück übernommen
    return false;
  }

  // ---------------------------------------------------------------------
  // Anzeige in der App
  // ---------------------------------------------------------------------

  /** Alle Einträge im Zeitraum [start, end) für die Kalenderansicht */
  items(start: string, end: string, customerId?: number): CalendarItem[] {
    const items: CalendarItem[] = [];
    const cust = customerId ? 'AND c.id = :cid' : '';
    const params = { start, end, cid: customerId ?? null };
    const eventLinks = new Map(
      this.db
        .all<{ linked_type: string; linked_id: number; html_link: string | null }>("SELECT linked_type, linked_id, html_link FROM calendar_events WHERE source = 'app' AND status <> 'cancelled'")
        .map((r) => [`${r.linked_type}:${r.linked_id}`, r.html_link]),
    );

    for (const s of this.db.all<{ project_id: number; title: string; customer_id: number; company_name: string; shoot_date: string; start_time: string | null; end_time: string | null; location: string | null; status: string }>(
      `SELECT s.project_id, p.title, c.id AS customer_id, c.company_name, s.shoot_date, s.start_time, s.end_time, s.location, p.status
       FROM shoots s JOIN projects p ON p.id = s.project_id JOIN customers c ON c.id = p.customer_id
       WHERE s.shoot_date >= :start AND s.shoot_date < :end AND p.status <> 'abgebrochen' ${cust}`,
      params,
    )) {
      const timed = !!s.start_time;
      items.push({
        id: `shoot:${s.project_id}`,
        kind: 'drehtag',
        title: `Drehtag: ${s.company_name} – ${s.title}`,
        start: timed ? `${s.shoot_date}T${s.start_time}` : s.shoot_date,
        end: timed ? (s.end_time && s.end_time > s.start_time! ? `${s.shoot_date}T${s.end_time}` : addMinutesLocal(`${s.shoot_date}T${s.start_time}`, 120)) : null,
        all_day: !timed,
        url: `/projekte/${s.project_id}`,
        external_url: eventLinks.get(`shoot:${s.project_id}`) ?? null,
        customer_id: s.customer_id,
        customer_name: s.company_name,
        location: s.location,
        editable: s.status !== 'abgeschlossen',
      });
    }

    for (const d of this.db.all<{ project_id: number; title: string; customer_id: number; company_name: string; phase: Phase; due_date: string }>(
      `SELECT p.id AS project_id, p.title, c.id AS customer_id, c.company_name, ph.phase, ph.due_date
       FROM projects p JOIN customers c ON c.id = p.customer_id
       JOIN project_phases ph ON ph.project_id = p.id AND ph.phase = p.current_phase
       WHERE p.status IN ('aktiv','pausiert') AND ph.phase > 1 AND ph.due_date >= :start AND ph.due_date < :end ${cust}`,
      params,
    )) {
      items.push({
        id: `phase:${d.project_id}:${d.phase}`,
        kind: 'deadline',
        title: `${PHASE_LABELS[d.phase]} fällig: ${d.company_name} – ${d.title}`,
        start: d.due_date,
        end: null,
        all_day: true,
        url: `/projekte/${d.project_id}`,
        external_url: null,
        customer_id: d.customer_id,
        customer_name: d.company_name,
        location: null,
        editable: true,
      });
    }

    for (const t of this.db.all<{ id: number; title: string; due_date: string; due_time: string | null; customer_id: number | null; company_name: string | null; project_id: number | null }>(
      `SELECT t.id, t.title, t.due_date, t.due_time, c.id AS customer_id, c.company_name, t.project_id
       FROM tasks t LEFT JOIN customers c ON c.id = t.customer_id
       WHERE t.status <> 'erledigt' AND t.due_date >= :start AND t.due_date < :end ${customerId ? 'AND t.customer_id = :cid' : ''}`,
      params,
    )) {
      items.push({
        id: `task:${t.id}`,
        kind: 'deadline',
        title: `Aufgabe: ${t.title}`,
        start: t.due_time ? `${t.due_date}T${t.due_time}` : t.due_date,
        end: t.due_time ? addMinutesLocal(`${t.due_date}T${t.due_time}`, 30) : null,
        all_day: !t.due_time,
        url: t.project_id ? `/projekte/${t.project_id}` : t.customer_id ? `/kunden/${t.customer_id}` : '/aufgaben',
        external_url: null,
        customer_id: t.customer_id,
        customer_name: t.company_name,
        location: null,
        editable: true,
      });
    }

    for (const a of this.approvalDeadlines()) {
      if (a.deadline < start || a.deadline >= end) continue;
      const p = this.db.get<{ customer_id: number }>('SELECT customer_id FROM projects WHERE id = ?', [a.project_id])!;
      if (customerId && p.customer_id !== customerId) continue;
      items.push({
        id: `approval:${a.project_id}`,
        kind: 'freigabe',
        title: `Freigabe-Frist: ${a.company_name} – ${a.title}`,
        start: a.deadline,
        end: null,
        all_day: true,
        url: `/projekte/${a.project_id}`,
        external_url: eventLinks.get(`approval:${a.project_id}`) ?? null,
        customer_id: p.customer_id,
        customer_name: a.company_name,
        location: null,
        editable: false,
      });
    }

    for (const pu of this.db.all<{ id: number; project_id: number; title: string; customer_id: number; company_name: string; platform: Platform; planned_date: string; planned_time: string | null; status: string }>(
      `SELECT pu.id, pu.project_id, p.title, c.id AS customer_id, c.company_name, pu.platform, pu.planned_date, pu.planned_time, pu.status
       FROM publications pu JOIN projects p ON p.id = pu.project_id JOIN customers c ON c.id = p.customer_id
       WHERE pu.planned_date >= :start AND pu.planned_date < :end AND p.status <> 'abgebrochen' ${cust}`,
      params,
    )) {
      items.push({
        id: `pub:${pu.id}`,
        kind: 'veroeffentlichung',
        title: `${pu.status === 'veroeffentlicht' ? 'Veröffentlicht' : 'Veröffentlichung'} ${PLATFORM_LABELS[pu.platform]}: ${pu.company_name} – ${pu.title}`,
        start: pu.planned_time ? `${pu.planned_date}T${pu.planned_time}` : pu.planned_date,
        end: pu.planned_time ? addMinutesLocal(`${pu.planned_date}T${pu.planned_time}`, 30) : null,
        all_day: !pu.planned_time,
        url: `/projekte/${pu.project_id}`,
        external_url: eventLinks.get(`publication:${pu.id}`) ?? null,
        customer_id: pu.customer_id,
        customer_name: pu.company_name,
        location: null,
        editable: pu.status !== 'veroeffentlicht',
      });
    }

    if (!customerId) {
      for (const e of this.db.all<{ id: number; title: string; start_at: string; end_at: string; all_day: number; location: string | null; html_link: string | null }>(
        `SELECT e.id, e.title, e.start_at, e.end_at, e.all_day, e.location, e.html_link FROM calendar_events e
         JOIN calendar_sync_state s ON s.google_calendar_id = e.google_calendar_id AND s.read_enabled = 1
         WHERE e.source = 'google' AND e.status <> 'cancelled' AND e.start_at < :endTs AND e.end_at > :start`,
        { start, endTs: `${end}T00:00` },
      )) {
        items.push({
          id: `google:${e.id}`,
          kind: 'termin',
          title: e.title,
          start: e.start_at,
          end: e.end_at,
          all_day: !!e.all_day,
          url: null,
          external_url: e.html_link,
          customer_id: null,
          customer_name: null,
          location: e.location,
          editable: false,
        });
      }
    }
    return items.sort((a, b) => a.start.localeCompare(b.start));
  }

  /** Eintrag in der Kalenderansicht verschoben */
  move(id: string, start: string, allDay: boolean, end?: string | null): void {
    const [type, a, b] = id.split(':');
    const date = start.slice(0, 10);
    const time = allDay ? null : start.slice(11, 16) || null;
    const now = nowIso();
    if (type === 'shoot') {
      const projectId = Number(a);
      const endTime = !allDay && end && end.slice(0, 10) === date ? end.slice(11, 16) : null;
      const r = this.db.run('UPDATE shoots SET shoot_date = ?, start_time = ?, end_time = ?, updated_at = ? WHERE project_id = ?', [date, time, endTime, now, projectId]);
      if (!r.changes) throw new HttpError(404, 'Drehtag nicht gefunden');
      this.db.run('UPDATE project_phases SET due_date = ? WHERE project_id = ? AND phase = 1', [date, projectId]);
      events.changed('projects', projectId);
    } else if (type === 'phase') {
      const r = this.db.run('UPDATE project_phases SET due_date = ? WHERE project_id = ? AND phase = ?', [date, Number(a), Number(b)]);
      if (!r.changes) throw new HttpError(404, 'Phase nicht gefunden');
      events.changed('projects', Number(a));
    } else if (type === 'task') {
      const r = this.db.run('UPDATE tasks SET due_date = ?, due_time = ?, updated_at = ? WHERE id = ?', [date, time, now, Number(a)]);
      if (!r.changes) throw new HttpError(404, 'Aufgabe nicht gefunden');
      events.changed('tasks', Number(a));
    } else if (type === 'pub') {
      const pub = this.db.get<{ project_id: number }>('SELECT project_id FROM publications WHERE id = ?', [Number(a)]);
      if (!pub) throw new HttpError(404, 'Veröffentlichung nicht gefunden');
      this.db.run('UPDATE publications SET planned_date = ?, planned_time = ?, updated_at = ? WHERE id = ?', [date, time, now, Number(a)]);
      events.changed('projects', pub.project_id);
    } else {
      throw new HttpError(400, 'Dieser Eintrag lässt sich nicht verschieben');
    }
    events.changed('calendar');
    this.requestSync();
  }

  shootCalendar(projectId: number): ShootCalendar {
    const shoot = this.db.get<{ shoot_date: string | null }>('SELECT shoot_date FROM shoots WHERE project_id = ?', [projectId]);
    const row = this.db.get<EventRow>("SELECT * FROM calendar_events WHERE source = 'app' AND linked_type = 'shoot' AND linked_id = ?", [projectId]);
    if (row?.status === 'cancelled') return { state: 'in_google_geloescht', html_link: null };
    if (row) return { state: 'eingetragen', html_link: row.html_link };
    if (!this.google.connected) return { state: 'nicht_verbunden', html_link: null };
    if (!shoot?.shoot_date) return { state: 'kein_datum', html_link: null };
    return { state: 'wartet', html_link: null };
  }

  /** In Google gelöschten Drehtag erneut eintragen */
  restoreShoot(projectId: number): ShootCalendar {
    this.db.run("UPDATE calendar_events SET content_hash = 'neu' WHERE source = 'app' AND linked_type = 'shoot' AND linked_id = ?", [projectId]);
    this.requestSync(0);
    return this.shootCalendar(projectId);
  }
}
