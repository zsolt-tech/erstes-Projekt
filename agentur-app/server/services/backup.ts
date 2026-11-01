// Datensicherung der SQLite-Datenbank.
// Ein Backup pro Tag: um 02:30 Uhr oder, falls der Rechner da aus war, kurz nach dem nächsten Start.
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from '../db/database.ts';
import type { AppConfig } from '../env.ts';
import { fileStampBerlin, nowIso, todayBerlin, timeBerlin } from '../lib/time.ts';
import { getSetting, setSetting } from './settings.ts';
import type { BackupInfo, BackupOverview } from '../../shared/schemas.ts';

const FILE_RE = /^agentur-(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})\.sqlite$/;
const DAILY_TIME = '02:30';
const DAY_MS = 24 * 60 * 60 * 1000;

export function listBackupFiles(dir: string): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .map((file) => {
      const stat = fs.statSync(path.join(dir, file));
      return { file, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.file.localeCompare(a.file));
}

/**
 * Aufbewahrung: alle Sicherungen der letzten keepDays Tage,
 * zusätzlich die jeweils erste Sicherung eines Monats für 12 Monate.
 */
export function pruneBackups(dir: string, keepDays: number, today = todayBerlin()): string[] {
  const files = listBackupFiles(dir)
    .map((b) => b.file)
    .sort();
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const firstOfMonth = new Map<string, string>();
  for (const f of files) {
    const month = f.slice(8, 15);
    if (!firstOfMonth.has(month)) firstOfMonth.set(month, f);
  }
  const deleted: string[] = [];
  for (const f of files) {
    const date = FILE_RE.exec(f)![1];
    const ageDays = Math.round((todayMs - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
    if (ageDays < keepDays) continue;
    const isMonthly = firstOfMonth.get(f.slice(8, 15)) === f;
    if (isMonthly && ageDays <= 366) continue;
    fs.rmSync(path.join(dir, f), { force: true });
    deleted.push(f);
  }
  return deleted;
}

export function isBackupDue(db: Database, now = new Date()): boolean {
  const last = getSetting<string | null>(db, 'last_backup_at', null);
  if (!last) return true;
  const lastDate = new Date(last);
  if (now.getTime() - lastDate.getTime() > DAY_MS) return true;
  return todayBerlin(lastDate) !== todayBerlin(now) && timeBerlin(now) >= DAILY_TIME;
}

export function runBackup(db: Database, config: AppConfig): BackupInfo {
  try {
    fs.mkdirSync(config.backupDir, { recursive: true });
    let file = `agentur-${fileStampBerlin()}.sqlite`;
    let target = path.join(config.backupDir, file);
    // Zwei Sicherungen in derselben Sekunde: kurz warten wäre unnötig, Dateiname bleibt eindeutig
    if (fs.existsSync(target)) {
      file = `agentur-${fileStampBerlin(new Date(Date.now() + 1000))}.sqlite`;
      target = path.join(config.backupDir, file);
    }
    // VACUUM INTO erzeugt eine konsistente, kompakte Kopie, auch während die App läuft
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    if (config.backupExtraDir) {
      fs.mkdirSync(config.backupExtraDir, { recursive: true });
      fs.copyFileSync(target, path.join(config.backupExtraDir, file));
      pruneBackups(config.backupExtraDir, config.backupKeepDays);
    }
    pruneBackups(config.backupDir, config.backupKeepDays);
    setSetting(db, 'last_backup_at', nowIso());
    setSetting(db, 'last_backup_error', null);
    const stat = fs.statSync(target);
    return { file, size: stat.size, created_at: stat.mtime.toISOString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSetting(db, 'last_backup_error', `${new Date().toLocaleString('de-DE')}: ${message}`);
    throw err;
  }
}

export function backupOverview(db: Database, config: AppConfig): BackupOverview {
  return {
    directory: config.backupDir,
    extra_directory: config.backupExtraDir,
    last_backup_at: getSetting<string | null>(db, 'last_backup_at', null),
    last_error: getSetting<string | null>(db, 'last_backup_error', null),
    keep_days: config.backupKeepDays,
    backups: listBackupFiles(config.backupDir),
  };
}
