// Stellt eine Datensicherung wieder her.
// Aufruf:  npm run restore                      zeigt die vorhandenen Sicherungen
//          npm run restore -- <Dateiname>       stellt diese Sicherung wieder her
// Die App muss dafür beendet sein. Der aktuelle Stand wird vorher zusätzlich gesichert.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: dotenv } = await import('dotenv');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const resolveDir = (v, fallback) => {
  const value = v && v.trim() ? v.trim() : fallback;
  return path.isAbsolute(value) ? value : path.resolve(root, value);
};
const dataDir = resolveDir(process.env.DATA_DIR, './data');
const backupDir = resolveDir(process.env.BACKUP_DIR, './backups');
const dbFile = path.join(dataDir, 'agentur.sqlite');
const port = Number(process.env.PORT) || 3000;

const files = fs.existsSync(backupDir)
  ? fs.readdirSync(backupDir).filter((f) => /^agentur-.*\.sqlite$/.test(f)).sort().reverse()
  : [];

const arg = process.argv[2];
if (!arg) {
  if (!files.length) {
    console.log(`Keine Sicherungen in ${backupDir} gefunden.`);
  } else {
    console.log(`Vorhandene Sicherungen in ${backupDir} (neueste zuerst):\n`);
    for (const f of files) console.log(`  ${f}`);
    console.log('\nWiederherstellen mit:  npm run restore -- <Dateiname>');
  }
  process.exit(0);
}

const source = path.isAbsolute(arg) ? arg : fs.existsSync(path.join(backupDir, arg)) ? path.join(backupDir, arg) : path.resolve(arg);
if (!fs.existsSync(source)) {
  console.error(`Sicherung nicht gefunden: ${source}`);
  process.exit(1);
}

// App muss beendet sein
const running = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })
  .then((r) => r.json())
  .then((b) => b?.app === 'agentur-verwaltung')
  .catch(() => false);
if (running) {
  console.error('Die App läuft noch. Bitte zuerst beenden (im Terminal Strg+C), dann erneut versuchen.');
  process.exit(1);
}

// Sicherung prüfen
try {
  const check = new DatabaseSync(source, { readOnly: true });
  const ok = check.prepare('PRAGMA integrity_check').get();
  check.prepare('SELECT COUNT(*) FROM customers').get();
  check.close();
  if (Object.values(ok)[0] !== 'ok') throw new Error('Integritätsprüfung fehlgeschlagen');
} catch (err) {
  console.error(`Die Datei ist keine gültige Sicherung: ${err.message}`);
  process.exit(1);
}

fs.mkdirSync(dataDir, { recursive: true });
if (fs.existsSync(dbFile)) {
  // Zeitstempel in Berliner Zeit wie bei den täglichen Sicherungen (z. B. 2026-11-03_12-04-12)
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'medium' })
    .format(new Date())
    .replace(' ', '_')
    .replace(/:/g, '-');
  const safety = path.join(dataDir, `vor-wiederherstellung-${stamp}.sqlite`);
  // VACUUM INTO übernimmt auch noch nicht zurückgeschriebene Änderungen aus der WAL-Datei
  const current = new DatabaseSync(dbFile);
  current.exec(`VACUUM INTO '${safety.replace(/'/g, "''")}'`);
  current.close();
  console.log(`Aktueller Stand gesichert: ${safety}`);
}
for (const suffix of ['-wal', '-shm']) fs.rmSync(dbFile + suffix, { force: true });
fs.copyFileSync(source, dbFile);
console.log(`Wiederhergestellt aus ${path.basename(source)}. Jetzt die App wieder starten: npm start`);
