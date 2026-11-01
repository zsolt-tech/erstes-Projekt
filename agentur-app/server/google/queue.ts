// Warteschlange für Google-Aktionen. Ohne Internet oder ohne Verbindung bleibt ein Auftrag liegen
// und wird später nachgeholt; bei Fehlern wird mit wachsendem Abstand erneut versucht.
import type { Database } from '../db/database.ts';
import { events } from '../lib/events.ts';
import { nowIso } from '../lib/time.ts';
import { GoogleApiError, GoogleNotConnectedError, type GoogleClient } from './client.ts';
import type { SyncJob } from '../../shared/schemas.ts';

type Handler = (payload: Record<string, unknown>) => Promise<void>;

const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 720];
const MAX_ATTEMPTS = 8;

export class SyncQueue {
  private handlers = new Map<string, Handler>();
  private current: Promise<number> | null = null;
  private kickTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private db: Database,
    private google: GoogleClient,
  ) {
    // Aufträge, die beim Beenden mitten im Lauf waren, erneut einplanen
    db.run("UPDATE sync_jobs SET status = 'wartend' WHERE status = 'laeuft'");
  }

  register(type: string, handler: Handler) {
    this.handlers.set(type, handler);
  }

  /** Neuen Auftrag einplanen; ein gleicher, noch offener Auftrag wird nicht doppelt angelegt */
  enqueue(type: string, payload: Record<string, unknown> & { label: string }): void {
    const json = JSON.stringify(payload);
    const exists = this.db.get(
      "SELECT 1 FROM sync_jobs WHERE job_type = ? AND payload_json = ? AND status IN ('wartend','laeuft')",
      [type, json],
    );
    if (!exists) this.db.run('INSERT INTO sync_jobs (job_type, payload_json) VALUES (?, ?)', [type, json]);
    events.changed('sync');
    this.kick();
  }

  /** Verarbeitung kurz verzögert anstoßen */
  kick() {
    if (this.kickTimer || this.stopped) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      void this.process();
    }, 50);
    this.kickTimer.unref?.();
  }

  /**
   * Arbeitet alle fälligen Aufträge ab und gibt die Zahl erledigter Aufträge zurück.
   * Läuft bereits eine Verarbeitung, wird auf sie gewartet und danach erneut geprüft.
   */
  process(): Promise<number> {
    if (this.current) return this.current.then(() => this.process());
    if (this.stopped || !this.google.connected) return Promise.resolve(0);
    this.current = this.run().finally(() => {
      this.current = null;
    });
    return this.current;
  }

  /** Beim Beenden: keine neuen Läufe, laufenden abwarten */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = null;
    await this.current?.catch(() => undefined);
  }

  private async run(): Promise<number> {
    let done = 0;
    {
      while (!this.stopped) {
        const job = this.db.get<{ id: number; job_type: string; payload_json: string; attempts: number }>(
          "SELECT id, job_type, payload_json, attempts FROM sync_jobs WHERE status = 'wartend' AND run_after <= ? ORDER BY id LIMIT 1",
          [nowIso()],
        );
        if (!job) break;
        const handler = this.handlers.get(job.job_type);
        this.db.run("UPDATE sync_jobs SET status = 'laeuft', updated_at = ? WHERE id = ?", [nowIso(), job.id]);
        try {
          if (!handler) throw new Error(`Unbekannter Auftrag: ${job.job_type}`);
          await handler(JSON.parse(job.payload_json));
          this.db.run("UPDATE sync_jobs SET status = 'fertig', last_error = NULL, updated_at = ? WHERE id = ?", [nowIso(), job.id]);
          done++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (err instanceof GoogleNotConnectedError) {
            // Ohne Verbindung nicht als Fehlversuch zählen
            this.db.run("UPDATE sync_jobs SET status = 'wartend', last_error = ?, updated_at = ? WHERE id = ?", [message, nowIso(), job.id]);
            break;
          }
          if (err instanceof GoogleApiError && err.status === 0) {
            // Kein Internet: in einer Minute erneut, ohne Fehlversuch zu zählen
            this.db.run("UPDATE sync_jobs SET status = 'wartend', last_error = ?, run_after = ?, updated_at = ? WHERE id = ?", [
              message,
              new Date(Date.now() + 60000).toISOString(),
              nowIso(),
              job.id,
            ]);
            break;
          }
          const attempts = job.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            this.db.run(
              "UPDATE sync_jobs SET status = 'fehler', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?",
              [attempts, message, nowIso(), job.id],
            );
            const label = (JSON.parse(job.payload_json) as { label?: string }).label ?? job.job_type;
            this.db.run(
              `INSERT INTO notifications (type, title, body, link, dedupe_key) VALUES ('sync_fehler', ?, ?, '/einstellungen', ?)
               ON CONFLICT(dedupe_key) DO NOTHING`,
              [`Google-Auftrag fehlgeschlagen: ${label}`, message, `sync_fehler:${job.id}`],
            );
          } else {
            const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
            this.db.run(
              "UPDATE sync_jobs SET status = 'wartend', attempts = ?, last_error = ?, run_after = ?, updated_at = ? WHERE id = ?",
              [attempts, message, new Date(Date.now() + minutes * 60000).toISOString(), nowIso(), job.id],
            );
          }
          console.error(`[Google] ${job.job_type} fehlgeschlagen (Versuch ${attempts}): ${message}`);
        }
        events.changed('sync');
      }
      // Erledigte Aufträge nach 7 Tagen aufräumen
      this.db.run("DELETE FROM sync_jobs WHERE status = 'fertig' AND updated_at < ?", [
        new Date(Date.now() - 7 * 86400000).toISOString(),
      ]);
    }
    return done;
  }

  list(): SyncJob[] {
    return this.db
      .all<Omit<SyncJob, 'label'> & { payload_json: string }>(
        `SELECT id, job_type, payload_json, status, attempts, last_error, run_after, created_at, updated_at FROM sync_jobs
         ORDER BY CASE status WHEN 'fehler' THEN 0 WHEN 'laeuft' THEN 1 WHEN 'wartend' THEN 2 ELSE 3 END, id DESC LIMIT 50`,
      )
      .map(({ payload_json, ...j }) => ({ ...j, label: (JSON.parse(payload_json) as { label?: string }).label ?? j.job_type }));
  }

  retry(id: number) {
    this.db.run(
      "UPDATE sync_jobs SET status = 'wartend', attempts = 0, run_after = ?, updated_at = ? WHERE id = ? AND status IN ('fehler','wartend')",
      [nowIso(), nowIso(), id],
    );
    events.changed('sync');
    this.kick();
  }

  /** Offener oder fehlgeschlagener Auftrag zu einem Datensatz */
  pendingFor(type: string, key: 'customer_id' | 'project_id', id: number): { status: string; last_error: string | null } | undefined {
    return this.db.get(
      `SELECT status, last_error FROM sync_jobs WHERE job_type = ? AND json_extract(payload_json, '$.${key}') = ?
       AND status IN ('wartend','laeuft','fehler') ORDER BY id DESC LIMIT 1`,
      [type, id],
    );
  }
}
