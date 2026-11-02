// Tägliches Briefing und Freigabe-Erinnerungen.
import type { Database } from '../db/database.ts';
import type { AppConfig } from '../env.ts';
import type { GmailService } from '../google/gmail.ts';
import type { GoogleClient } from '../google/client.ts';
import type { CalendarService } from '../google/calendar.ts';
import { events } from '../lib/events.ts';
import { addDays, berlinDateOf, berlinParts, daysBetween, nowIso, timeBerlin, todayBerlin } from '../lib/time.ts';
import { detectBottlenecks } from './bottlenecks.ts';
import { packageUsage } from './customers.ts';
import { notify } from './notify.ts';
import { getSettings } from './settings.ts';
import { PHASE_LABELS, type Briefing, type BriefingData, type Phase } from '../../shared/schemas.ts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const LONG_DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
const shortDate = (d: string) => `${WEEKDAYS[weekday(d)]} ${d.slice(8, 10)}.${d.slice(5, 7)}.`;
const longDate = (d: string) => `${LONG_DAYS[weekday(d)]}, ${Number(d.slice(8, 10))}. ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

function timeOf(start: string, allDay: boolean): string | null {
  if (allDay) return null;
  if (/Z$|[+-]\d{2}:\d{2}$/.test(start)) return timeBerlin(new Date(start)); // Google-Zeitpunkt
  return start.slice(11, 16);
}

export class BriefingService {
  constructor(
    private db: Database,
    private config: AppConfig,
    private services: { calendar: CalendarService; google: GoogleClient; gmail: GmailService },
  ) {}

  private url(path: string | null) {
    return path ? `http://localhost:${this.config.port}${path}` : null;
  }

  /** Stellt die Inhalte des Briefings für einen Tag zusammen */
  build(date = todayBerlin()): BriefingData {
    const db = this.db;
    const settings = getSettings(db);

    const appointments = this.services.calendar
      .items(date, addDays(date, 1))
      .filter((i) => i.kind === 'drehtag' || i.kind === 'termin' || i.kind === 'veroeffentlichung')
      .map((i) => ({ time: timeOf(i.start, i.all_day), title: i.title, kind: i.kind, location: i.location, url: i.url }))
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

    // Fällig: Aufgaben und Phasenfristen (die Phase Drehtag steht schon bei den Terminen)
    const due = db.all<{ title: string; customer: string | null; due_date: string; url: string | null }>(
      `SELECT 'Aufgabe: ' || t.title AS title, c.company_name AS customer, t.due_date,
              CASE WHEN t.project_id IS NOT NULL THEN '/projekte/' || t.project_id ELSE '/aufgaben' END AS url
       FROM tasks t LEFT JOIN customers c ON c.id = t.customer_id
       WHERE t.status <> 'erledigt' AND t.due_date <= :date AND c.archived_at IS NULL
       UNION ALL
       SELECT p.current_phase || '|' || p.title, c.company_name, ph.due_date, '/projekte/' || p.id
       FROM projects p JOIN customers c ON c.id = p.customer_id
       JOIN project_phases ph ON ph.project_id = p.id AND ph.phase = p.current_phase
       WHERE p.status = 'aktiv' AND p.current_phase > 1 AND ph.due_date <= :date AND c.archived_at IS NULL
       ORDER BY 3`,
      { date },
    ).map((r) => {
      const m = /^(\d)\|(.*)$/.exec(r.title);
      return { ...r, title: m ? `${PHASE_LABELS[Number(m[1]) as Phase]}: ${m[2]}` : r.title };
    });
    const due_today = due.filter((d) => d.due_date === date).map(({ title, customer, url }) => ({ title, customer, url }));
    const overdue = due
      .filter((d) => d.due_date < date)
      .map(({ title, customer, url, due_date }) => ({ title, customer, url, due_date, days: daysBetween(due_date, date) }));

    const defaultDays = settings.approval_reminder_days;
    const approvals = db
      .all<{ project_id: number; title: string; customer: string; requested_at: string; days: number | null }>(
        `SELECT p.id AS project_id, p.title, c.company_name AS customer, ar.requested_at,
                COALESCE(p.approval_reminder_days, c.approval_reminder_days) AS days
         FROM approval_rounds ar JOIN projects p ON p.id = ar.project_id JOIN customers c ON c.id = p.customer_id
         WHERE ar.responded_at IS NULL AND p.current_phase = 4 AND p.status = 'aktiv' AND c.archived_at IS NULL`,
      )
      .map((a) => {
        const waiting = daysBetween(berlinDateOf(a.requested_at), date);
        return {
          title: a.title,
          customer: a.customer,
          requested_at: a.requested_at,
          waiting_days: waiting,
          follow_up: waiting >= (a.days ?? defaultDays),
          url: `/projekte/${a.project_id}`,
        };
      })
      .sort((a, b) => b.waiting_days - a.waiting_days);

    const shoots = db
      .all<{ project_id: number; title: string; customer: string; shoot_date: string; start_time: string | null; location: string | null }>(
        `SELECT p.id AS project_id, p.title, c.company_name AS customer, s.shoot_date, s.start_time, s.location
         FROM shoots s JOIN projects p ON p.id = s.project_id JOIN customers c ON c.id = p.customer_id
         WHERE p.status IN ('aktiv','pausiert') AND s.shoot_date > :date AND s.shoot_date <= :to AND c.archived_at IS NULL
         ORDER BY s.shoot_date, s.start_time`,
        { date, to: addDays(date, 7) },
      )
      .map((s) => ({ date: s.shoot_date, time: s.start_time, title: s.title, customer: s.customer, location: s.location, url: `/projekte/${s.project_id}` }));

    const month = date.slice(0, 7);
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    const progress = Number(date.slice(8, 10)) / lastDay;
    const packages = db
      .all<{ id: number; company_name: string }>(
        `SELECT DISTINCT c.id, c.company_name FROM customers c JOIN package_items pi ON pi.customer_id = c.id
         WHERE c.status = 'aktiv' AND c.archived_at IS NULL ORDER BY c.company_name COLLATE NOCASE`,
      )
      .map((c) => {
        const items = packageUsage(db, c.id, month).map((u) => ({ type: u.deliverable_type_name, used: u.used, quantity: u.quantity }));
        const status: 'ok' | 'rueckstand' | 'ueber' = items.some((i) => i.used > i.quantity)
          ? 'ueber'
          : progress >= 2 / 3 && items.some((i) => i.used < i.quantity / 2)
            ? 'rueckstand'
            : 'ok';
        return { customer_id: c.id, customer: c.company_name, month, items, status };
      })
      .filter((p) => p.items.length > 0);

    const warnings = detectBottlenecks(db, date);

    const followUps = approvals.filter((a) => a.follow_up).length;
    const parts: string[] = [];
    if (appointments.length) parts.push(`Heute ${plural(appointments.length, 'Termin', 'Termine')}`);
    if (due_today.length) parts.push(`${due_today.length} heute fällig`);
    if (overdue.length) parts.push(`${overdue.length} überfällig`);
    const first = parts.length ? `${parts.join(', ')}.` : 'Heute keine Termine und nichts fällig.';
    const more: string[] = [];
    if (approvals.length) {
      more.push(`${plural(approvals.length, 'Freigabe', 'Freigaben')} offen${followUps ? `, ${followUps} zum Nachfassen` : ''}.`);
    }
    if (shoots.length) more.push(`${plural(shoots.length, 'Drehtag', 'Drehtage')} in den nächsten 7 Tagen.`);
    if (warnings.length) more.push(`${plural(warnings.length, 'Warnung', 'Warnungen')}.`);

    return {
      date,
      generated_at: nowIso(),
      agency_name: settings.agency_name,
      summary: [first, ...more].join(' '),
      appointments,
      due_today,
      overdue,
      approvals,
      shoots,
      packages,
      warnings,
    };
  }

  /** Ausformulierter Text für E-Mail und Protokoll */
  renderText(d: BriefingData): string {
    const lines: string[] = [`Briefing für ${longDate(d.date)}`, '', d.summary];
    const section = (title: string, rows: string[]) => {
      if (rows.length) lines.push('', title, ...rows.map((r) => `- ${r}`));
    };
    const cust = (c: string | null) => (c ? ` (${c})` : '');
    section('Termine heute', d.appointments.map((a) => `${a.time ?? 'ganztägig'}: ${a.title}${a.location ? `, ${a.location}` : ''}`));
    section('Heute fällig', d.due_today.map((x) => `${x.title}${cust(x.customer)}`));
    section('Überfällig', d.overdue.map((x) => `${x.title}${cust(x.customer)}, seit ${plural(x.days, 'Tag', 'Tagen')}`));
    section(
      'Warten auf Freigabe',
      d.approvals.map((a) => `${a.title} (${a.customer}), seit ${plural(a.waiting_days, 'Tag', 'Tagen')}${a.follow_up ? ', nachfassen' : ''}`),
    );
    section('Drehtage der nächsten 7 Tage', d.shoots.map((s) => `${shortDate(s.date)}${s.time ? `, ${s.time}` : ''}: ${s.title} (${s.customer})${s.location ? `, ${s.location}` : ''}`));
    if (d.packages.length) {
      section(
        `Paketverbrauch ${monthName(d.packages[0].month)}`,
        d.packages.map(
          (p) =>
            `${p.customer}: ${p.items.map((i) => `${i.used} von ${i.quantity} × ${i.type}`).join(', ')}${p.status === 'rueckstand' ? ' (Rückstand)' : p.status === 'ueber' ? ' (über Paket)' : ''}`,
        ),
      );
    }
    section('Warnungen', d.warnings.map((w) => w.text));
    lines.push('', `Agentur-Verwaltung: ${this.url('/')}`);
    return lines.join('\n');
  }

  /** Schlichtes HTML für die E-Mail */
  renderHtml(d: BriefingData): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const link = (text: string, path: string | null) => (path ? `<a href="${this.url(path)}" style="color:#2f54c9;text-decoration:none">${esc(text)}</a>` : esc(text));
    const parts: string[] = [];
    const section = (title: string, rows: string[]) => {
      if (!rows.length) return;
      parts.push(
        `<h3 style="font-size:14px;margin:20px 0 6px;color:#1a1f29">${esc(title)}</h3><ul style="margin:0;padding-left:18px;color:#1a1f29">${rows
          .map((r) => `<li style="margin:3px 0">${r}</li>`)
          .join('')}</ul>`,
      );
    };
    const cust = (c: string | null) => (c ? ` <span style="color:#5b6474">(${esc(c)})</span>` : '');
    section('Termine heute', d.appointments.map((a) => `<b>${a.time ?? 'ganztägig'}</b> ${link(a.title, a.url)}${a.location ? `, ${esc(a.location)}` : ''}`));
    section('Heute fällig', d.due_today.map((x) => `${link(x.title, x.url)}${cust(x.customer)}`));
    section('Überfällig', d.overdue.map((x) => `${link(x.title, x.url)}${cust(x.customer)}, <span style="color:#c0352b">seit ${plural(x.days, 'Tag', 'Tagen')}</span>`));
    section(
      'Warten auf Freigabe',
      d.approvals.map(
        (a) => `${link(a.title, a.url)}${cust(a.customer)}, seit ${plural(a.waiting_days, 'Tag', 'Tagen')}${a.follow_up ? ' <b style="color:#9a6200">nachfassen</b>' : ''}`,
      ),
    );
    section('Drehtage der nächsten 7 Tage', d.shoots.map((s) => `<b>${shortDate(s.date)}${s.time ? `, ${s.time}` : ''}</b> ${link(s.title, s.url)}${cust(s.customer)}`));
    if (d.packages.length) {
      section(
        `Paketverbrauch ${monthName(d.packages[0].month)}`,
        d.packages.map(
          (p) =>
            `${link(p.customer, `/kunden/${p.customer_id}`)}: ${esc(p.items.map((i) => `${i.used} von ${i.quantity} × ${i.type}`).join(', '))}${
              p.status === 'rueckstand' ? ' <b style="color:#c0352b">Rückstand</b>' : p.status === 'ueber' ? ' <b style="color:#9a6200">über Paket</b>' : ''
            }`,
        ),
      );
    }
    section('Warnungen', d.warnings.map((w) => link(w.text, w.url)));
    return `<!doctype html><html lang="de"><body style="margin:0;background:#f5f6f8;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.5">
<div style="max-width:640px;margin:0 auto;padding:24px">
<div style="background:#fff;border:1px solid #e1e4ea;border-radius:8px;padding:24px">
<div style="font-size:12px;color:#5b6474">${esc(d.agency_name)}</div>
<h2 style="font-size:18px;margin:4px 0 12px;color:#1a1f29">Briefing für ${esc(longDate(d.date))}</h2>
<p style="margin:0;color:#1a1f29">${esc(d.summary)}</p>
${parts.join('\n')}
<p style="margin:24px 0 0;font-size:12px;color:#8a92a1"><a href="${this.url('/')}" style="color:#2f54c9">In der Agentur-Verwaltung öffnen</a></p>
</div></div></body></html>`;
  }

  // ---------------------------------------------------------------------
  // Speichern, benachrichtigen, versenden
  // ---------------------------------------------------------------------

  get(date: string): Briefing | null {
    const row = this.db.get<{ id: number; briefing_date: string; generated_at: string; data_json: string; text: string; notified_at: string | null; emailed_at: string | null }>(
      'SELECT * FROM briefings WHERE briefing_date = ?',
      [date],
    );
    if (!row) return null;
    const { data_json, ...rest } = row;
    return { ...rest, data: JSON.parse(data_json) as BriefingData };
  }

  list(limit = 14): { briefing_date: string; generated_at: string }[] {
    return this.db.all('SELECT briefing_date, generated_at FROM briefings ORDER BY briefing_date DESC LIMIT ?', [limit]);
  }

  isDue(now = new Date()): boolean {
    const time = getSettings(this.db).briefing_time;
    // Ein nur zur Ansicht erzeugtes Briefing (ohne Versand) ersetzt nicht das tägliche
    return timeBerlin(now) >= time && !this.db.get('SELECT 1 FROM briefings WHERE briefing_date = ? AND notified_at IS NOT NULL', [todayBerlin(now)]);
  }

  /** Erzeugt (oder ersetzt) das Briefing des Tages, benachrichtigt und versendet es */
  generate(opts: { deliver?: boolean; date?: string } = {}): Briefing {
    const date = opts.date ?? todayBerlin();
    const data = this.build(date);
    const text = this.renderText(data);
    this.db.run(
      `INSERT INTO briefings (briefing_date, generated_at, data_json, text) VALUES (:date, :at, :json, :text)
       ON CONFLICT(briefing_date) DO UPDATE SET generated_at = excluded.generated_at, data_json = excluded.data_json, text = excluded.text`,
      { date, at: data.generated_at, json: JSON.stringify(data), text },
    );
    if (opts.deliver !== false) this.deliver(date, data, text);
    events.changed('briefing');
    return this.get(date)!;
  }

  private deliver(date: string, data: BriefingData, text: string) {
    const settings = getSettings(this.db);
    notify(this.db, {
      type: 'briefing',
      title: `Briefing für ${longDate(date)}`,
      body: data.summary,
      link: '/',
      dedupeKey: `briefing:${date}:${data.generated_at}`,
      desktop: settings.briefing_desktop,
    });
    this.db.run('UPDATE briefings SET notified_at = ? WHERE briefing_date = ?', [nowIso(), date]);
    if (settings.briefing_email_enabled && this.services.google.connected) {
      const to = settings.briefing_email_to || this.services.google.status().email;
      if (to) {
        this.services.gmail.send(to, `Briefing ${shortDate(date)} – ${data.summary}`.slice(0, 180), text, this.renderHtml(data));
        this.db.run('UPDATE briefings SET emailed_at = ? WHERE briefing_date = ?', [nowIso(), date]);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Freigabe-Erinnerungen
  // ---------------------------------------------------------------------

  /** Erinnert an Freigaben, die länger als die eingestellte Frist offen sind. Nur tagsüber. */
  remindApprovals(now = new Date()): number {
    const settings = getSettings(this.db);
    if (!settings.reminder_enabled) return 0;
    const hour = berlinParts(now).hour;
    if (hour < 9 || hour >= 19) return 0;
    const today = todayBerlin(now);
    const rounds = this.db.all<{ id: number; project_id: number; round_no: number; title: string; customer: string; customer_id: number; requested_at: string; last_reminder_at: string | null; reminder_count: number; days: number | null }>(
      `SELECT ar.id, ar.project_id, ar.round_no, p.title, c.company_name AS customer, c.id AS customer_id, ar.requested_at,
              ar.last_reminder_at, ar.reminder_count, COALESCE(p.approval_reminder_days, c.approval_reminder_days) AS days
       FROM approval_rounds ar JOIN projects p ON p.id = ar.project_id JOIN customers c ON c.id = p.customer_id
       WHERE ar.responded_at IS NULL AND p.current_phase = 4 AND p.status = 'aktiv' AND c.archived_at IS NULL`,
    );
    let sent = 0;
    for (const r of rounds) {
      const days = r.days ?? settings.approval_reminder_days;
      const waiting = daysBetween(berlinDateOf(r.requested_at), today);
      if (waiting < days) continue;
      if (r.last_reminder_at && daysBetween(berlinDateOf(r.last_reminder_at), today) < days) continue;
      const contact = this.db.get<{ name: string; email: string | null }>(
        'SELECT name, email FROM contacts WHERE customer_id = ? ORDER BY is_primary DESC, sort_order, id LIMIT 1',
        [r.customer_id],
      );
      const title = `Freigabe nachfassen: ${r.title}`;
      const body = `${r.customer} hat seit ${plural(waiting, 'Tag', 'Tagen')} nicht auf die Freigabeanfrage (Runde ${r.round_no}) reagiert.${contact ? ` Ansprechpartner: ${contact.name}.` : ''}`;
      const created = notify(this.db, {
        type: 'freigabe_erinnerung',
        title,
        body,
        link: `/projekte/${r.project_id}`,
        // requested_at gehört dazu: Runden-IDs können nach dem Zurücknehmen einer Anfrage neu vergeben werden
        dedupeKey: `freigabe:${r.id}:${r.requested_at}:${r.reminder_count + 1}`,
        desktop: true,
      });
      this.db.run('UPDATE approval_rounds SET last_reminder_at = ?, reminder_count = reminder_count + 1 WHERE id = ?', [nowIso(), r.id]);
      if (created && settings.reminder_email && this.services.google.connected) {
        const to = settings.briefing_email_to || this.services.google.status().email;
        if (to) {
          this.services.gmail.send(
            to,
            title,
            `${body}\n\nProjekt öffnen: ${this.url(`/projekte/${r.project_id}`)}`,
            `<p>${body.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><p><a href="${this.url(`/projekte/${r.project_id}`)}">Projekt öffnen</a></p>`,
          );
        }
      }
      if (created) sent++;
      events.changed('projects', r.project_id);
    }
    return sent;
  }
}
