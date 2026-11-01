// Liest die Konfiguration aus der .env-Datei. Fehlende Werte erhalten sinnvolle Standards.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env immer aus dem App-Ordner laden, unabhängig vom aktuellen Arbeitsverzeichnis (wichtig für Autostart)
dotenv.config({ path: path.join(APP_ROOT, '.env'), quiet: true });

function resolveDir(value: string | undefined, fallback: string): string {
  const v = value && value.trim() ? value.trim() : fallback;
  return path.isAbsolute(v) ? v : path.resolve(APP_ROOT, v);
}

export interface AppConfig {
  port: number;
  host: string;
  appSecret: string;
  dataDir: string;
  dbFile: string;
  backupDir: string;
  backupExtraDir: string | null;
  backupKeepDays: number;
  clientDist: string;
  google: { clientId: string; clientSecret: string; redirectUri: string };
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const port = Number(process.env.PORT) || 3000;
  const dataDir = resolveDir(process.env.DATA_DIR, './data');
  const extra = process.env.BACKUP_EXTRA_DIR?.trim();
  const config: AppConfig = {
    port,
    // Nur vom eigenen Rechner erreichbar
    host: '127.0.0.1',
    appSecret: process.env.APP_SECRET || '',
    dataDir,
    dbFile: path.join(dataDir, 'agentur.sqlite'),
    backupDir: resolveDir(process.env.BACKUP_DIR, './backups'),
    backupExtraDir: extra ? resolveDir(extra, extra) : null,
    backupKeepDays: Math.max(1, Number(process.env.BACKUP_KEEP_DAYS) || 30),
    clientDist: path.join(APP_ROOT, 'dist', 'client'),
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/api/google/callback`,
    },
  };
  return { ...config, ...overrides };
}
