// Einstellungen: Schlüssel/Wert-Paare mit Standardwerten.
import type { Database } from '../db/database.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/schemas.ts';

export function getSetting<T>(db: Database, key: string, fallback: T): T {
  const row = db.get<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: Database, key: string, value: unknown): void {
  db.run(
    `INSERT INTO settings (key, value_json) VALUES (:key, :value)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    { key, value: JSON.stringify(value) },
  );
}

export function getSettings(db: Database): Settings {
  const result = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    result[key] = getSetting(db, key, (DEFAULT_SETTINGS as Record<string, unknown>)[key]);
  }
  return result as Settings;
}

export function updateSettings(db: Database, patch: Partial<Settings>): Settings {
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && key in DEFAULT_SETTINGS) setSetting(db, key, value);
    }
  });
  return getSettings(db);
}
