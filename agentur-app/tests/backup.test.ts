import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startTestApp, type TestApp } from './helpers.ts';
import { isBackupDue, pruneBackups } from '../server/services/backup.ts';
import { setSetting } from '../server/services/settings.ts';

let t: TestApp;
before(async () => {
  t = await startTestApp();
});
after(async () => {
  await t.close();
});

test('Backup erzeugt eine lesbare Kopie der Datenbank', async () => {
  await t.request('POST', '/api/customers', { company_name: 'Backup-Test GmbH' });
  const res = await t.request('POST', '/api/backups');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const file = path.join(t.config.backupDir, res.body.file);
  assert.ok(fs.existsSync(file));
  const copy = new DatabaseSync(file, { readOnly: true });
  const row = copy.prepare('SELECT company_name FROM customers').get() as { company_name: string };
  copy.close();
  assert.equal(row.company_name, 'Backup-Test GmbH');

  const overview = await t.request('GET', '/api/backups');
  assert.equal(overview.body.backups.length, 1);
  assert.ok(overview.body.last_backup_at);
  assert.equal(isBackupDue(t.db), false, 'direkt nach einem Backup ist keines fällig');
});

test('Fälligkeit: einmal täglich ab 02:30, spätestens nach 24 Stunden', () => {
  // letztes Backup gestern 03:00 Berlin (02:00 UTC im Winter)
  setSetting(t.db, 'last_backup_at', '2026-11-01T02:00:00.000Z');
  assert.equal(isBackupDue(t.db, new Date('2026-11-02T00:30:00.000Z')), false, '01:30 Berlin: noch nicht fällig');
  assert.equal(isBackupDue(t.db, new Date('2026-11-02T01:31:00.000Z')), true, '02:31 Berlin: fällig');
  // Rechner war zwei Tage aus: sofort fällig, egal welche Uhrzeit
  setSetting(t.db, 'last_backup_at', '2026-10-30T20:00:00.000Z');
  assert.equal(isBackupDue(t.db, new Date('2026-11-01T23:10:00.000Z')), true);
});

test('Aufbewahrung: 30 Tage täglich, danach eine Sicherung je Monat', () => {
  const dir = path.join(t.dir, 'prune');
  fs.mkdirSync(dir);
  const files = [
    'agentur-2026-10-25_02-30-00.sqlite', // jung, bleibt
    'agentur-2026-09-15_02-30-00.sqlite', // alt, aber nicht erste im Monat -> weg
    'agentur-2026-09-01_02-30-00.sqlite', // erste im September -> bleibt
    'agentur-2026-09-01_14-00-00.sqlite', // zweite am selben Tag -> weg
    'agentur-2025-06-01_02-30-00.sqlite', // älter als 12 Monate -> weg
    'fremde-datei.txt', // wird ignoriert
  ];
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'x');
  const deleted = pruneBackups(dir, 30, '2026-11-01').sort();
  assert.deepEqual(deleted, [
    'agentur-2025-06-01_02-30-00.sqlite',
    'agentur-2026-09-01_14-00-00.sqlite',
    'agentur-2026-09-15_02-30-00.sqlite',
  ]);
  assert.ok(fs.existsSync(path.join(dir, 'fremde-datei.txt')));
});
