// Zeitplaner: prüft jede Minute, ob eine Aufgabe fällig ist.
// Dieses Prinzip holt verpasste Läufe automatisch nach, wenn der Rechner aus war oder geschlafen hat.
import type { Database } from '../db/database.ts';
import type { AppConfig } from '../env.ts';
import { events } from '../lib/events.ts';
import { isBackupDue, runBackup } from '../services/backup.ts';
import type { Services } from '../google/index.ts';

interface Job {
  name: string;
  isDue: () => boolean;
  run: () => void | Promise<void>;
}

export function startScheduler(db: Database, config: AppConfig, services: Services) {
  let lastFinalCheck = 0;
  const jobs: Job[] = [
    {
      name: 'Google-Warteschlange',
      isDue: () => services.google.connected,
      run: async () => {
        await services.queue.process();
      },
    },
    {
      // Alle 15 Minuten: liegen Dateien im Ordner "Fertige Videos"?
      name: 'Drive: Fertige Videos prüfen',
      isDue: () => services.google.connected && Date.now() - lastFinalCheck > 15 * 60 * 1000,
      run: async () => {
        lastFinalCheck = Date.now();
        await services.drive.checkAllFinal();
      },
    },
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
