// Zeitplaner: prüft jede Minute, ob eine Aufgabe fällig ist.
// Dieses Prinzip holt verpasste Läufe automatisch nach, wenn der Rechner aus war oder geschlafen hat.
import type { Database } from '../db/database.ts';
import type { AppConfig } from '../env.ts';
import { events } from '../lib/events.ts';
import { isBackupDue, runBackup } from '../services/backup.ts';

interface Job {
  name: string;
  isDue: () => boolean;
  run: () => void | Promise<void>;
}

export function startScheduler(db: Database, config: AppConfig) {
  const jobs: Job[] = [
    {
      name: 'Datensicherung',
      isDue: () => isBackupDue(db),
      run: () => {
        const b = runBackup(db, config);
        console.log(`[Backup] ${b.file} gespeichert (${Math.round(b.size / 1024)} KB)`);
        events.changed('backups');
      },
    },
  ];

  const running = new Set<string>();
  const failedAt = new Map<string, number>();

  async function tick() {
    for (const job of jobs) {
      if (running.has(job.name)) continue;
      // Nach einem Fehler 15 Minuten warten, bevor es erneut versucht wird
      const lastFail = failedAt.get(job.name);
      if (lastFail && Date.now() - lastFail < 15 * 60 * 1000) continue;
      try {
        if (!job.isDue()) continue;
        running.add(job.name);
        await job.run();
        failedAt.delete(job.name);
      } catch (err) {
        failedAt.set(job.name, Date.now());
        console.error(`[Zeitplaner] ${job.name} fehlgeschlagen:`, err instanceof Error ? err.message : err);
      } finally {
        running.delete(job.name);
      }
    }
  }

  const first = setTimeout(tick, 5000);
  const interval = setInterval(tick, 60 * 1000);
  return {
    tick,
    stop() {
      clearTimeout(first);
      clearInterval(interval);
    },
  };
}
