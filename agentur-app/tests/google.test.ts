import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startTestApp, type TestApp } from './helpers.ts';
import { startFakeGoogle } from './fake-google.ts';
import { decrypt, encrypt } from '../server/google/crypto.ts';
import { normalizeName, parseFolderId } from '../server/google/drive.ts';

let t: TestApp;
let g: Awaited<ReturnType<typeof startFakeGoogle>>;
const FOLDER = 'application/vnd.google-apps.folder';

before(async () => {
  g = await startFakeGoogle();
  t = await startTestApp({ google: g.google('http://localhost:3000/api/google/callback') });
});
after(async () => {
  await t.close();
  await g.close();
});

const flush = () => t.services.queue.process();

test('Hilfsfunktionen: Verschlüsselung, Ordnerlinks, Namensvergleich', () => {
  const enc = encrypt('geheimer-token', 'schluessel');
  assert.notEqual(enc, 'geheimer-token');
  assert.equal(decrypt(enc, 'schluessel'), 'geheimer-token');
  assert.throws(() => decrypt(enc, 'falsch'));
  assert.equal(parseFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn?usp=sharing'), '1AbCdEfGhIjKlMn');
  assert.equal(parseFolderId('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMn'), '1AbCdEfGhIjKlMn');
  assert.throws(() => parseFolderId('https://example.com'));
  assert.equal(normalizeName('03 · Fertige Videos'), 'fertige videos');
  assert.equal(normalizeName('02_Entwürfe'), 'entwurfe');
});

test('Zugangsdaten-Datei von Google übernehmen', async () => {
  const bad = await t.request('POST', '/api/google/credentials', { json: '{"installed":{"client_id":"x","client_secret":"y"}}' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Webanwendung/);

  fs.writeFileSync(t.config.envFile, 'PORT=3000\nGOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\n');
  const res = await t.request('POST', '/api/google/credentials', {
    json: JSON.stringify({
      web: { client_id: 'client-123.apps.googleusercontent.com', client_secret: 'geheim', redirect_uris: ['http://localhost:3000/api/google/callback'] },
    }),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.redirect_uri_ok, true);
  assert.equal(res.body.status.configured, true);
  assert.equal(res.body.status.connected, false);
  const env = fs.readFileSync(t.config.envFile, 'utf8');
  assert.match(env, /^GOOGLE_CLIENT_ID=client-123\.apps\.googleusercontent\.com$/m);
  assert.match(env, /^GOOGLE_CLIENT_SECRET=geheim$/m);
  assert.match(env, /^PORT=3000$/m, 'andere Werte bleiben erhalten');
});

test('Anmeldung bei Google: Weiterleitung, Rückkehr, Tokens verschlüsselt gespeichert', async () => {
  const redirect = await fetch(`${t.url}/api/google/auth`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  const target = new URL(redirect.headers.get('location')!);
  assert.equal(target.searchParams.get('client_id'), 'client-123.apps.googleusercontent.com');
  assert.equal(target.searchParams.get('access_type'), 'offline');
  assert.match(target.searchParams.get('scope')!, /auth\/drive .*auth\/calendar .*gmail\.send/);
  const state = target.searchParams.get('state')!;

  const wrongState = await fetch(`${t.url}/api/google/callback?code=gut&state=falsch`, { redirect: 'manual' });
  assert.match(decodeURIComponent(wrongState.headers.get('location')!), /google=fehler/);

  const cb = await fetch(`${t.url}/api/google/callback?code=gut&state=${state}`, { redirect: 'manual' });
  assert.match(cb.headers.get('location')!, /google=verbunden/);
  const status = (await t.request('GET', '/api/google/status')).body;
  assert.equal(status.connected, true);
  assert.equal(status.email, 'inhaber@beispiel.de');
  assert.deepEqual(status.missing_scopes, []);
  const row = t.db.get<{ refresh_token_enc: string }>('SELECT refresh_token_enc FROM google_accounts')!;
  assert.ok(!row.refresh_token_enc.includes('rt1'), 'Token nicht im Klartext');
});

test('Neuer Kunde bekommt Ordner mit Unterordnern im Stammordner „Kunden“, Interessent nicht', async () => {
  const c = (await t.request('POST', '/api/customers', { company_name: 'Pizzeria Roma', customer_type: 'restaurant' })).body;
  const lead = (await t.request('POST', '/api/customers', { company_name: 'Fahrschule Blitz', status: 'interessent' })).body;
  assert.equal((await t.request('GET', `/api/customers/${c.id}/drive`)).body.state, 'wartet');
  await flush();

  const [root] = g.find('Kunden', 'root');
  assert.ok(root, 'Stammordner angelegt');
  const [folder] = g.find('Pizzeria Roma', root.id);
  assert.ok(folder, 'Kundenordner angelegt');
  assert.deepEqual(g.children(folder.id).map((f) => f.name).sort(), ['Scripts', 'Sonstiges']);
  const drive = (await t.request('GET', `/api/customers/${c.id}/drive`)).body;
  assert.equal(drive.state, 'bereit');
  assert.equal(drive.folder.origin, 'angelegt');
  assert.equal(drive.folder.web_url, `https://drive.google.com/drive/folders/${folder.id}`);

  assert.equal((await t.request('GET', `/api/customers/${lead.id}/drive`)).body.state, 'fehlt');
  assert.equal(g.find('Fahrschule Blitz').length, 0, 'Interessent ohne Ordner');
  await t.request('PUT', `/api/customers/${lead.id}`, { company_name: 'Fahrschule Blitz', status: 'aktiv' });
  await flush();
  assert.equal(g.find('Fahrschule Blitz', root.id).length, 1, 'nach Umwandlung angelegt');
});

test('Neues Projekt: Jahresordner, Projektordner und vier Unterordner, ohne Doppelungen', async () => {
  const c = t.db.get<{ id: number }>("SELECT id FROM customers WHERE company_name = 'Pizzeria Roma'")!;
  const p = (await t.request('POST', '/api/projects', { customer_id: c.id, title: 'Reels November', service_month: '2026-11' })).body;
  await flush();
  const [customerFolder] = g.find('Pizzeria Roma');
  const [year] = g.find('2026', customerFolder.id);
  assert.ok(year, 'Jahresordner');
  const [pf] = g.find('2026-11 Reels November', year.id);
  assert.ok(pf, 'Projektordner');
  assert.deepEqual(g.children(pf.id).map((f) => f.name), ['01 Rohmaterial', '02 Entwürfe', '03 Fertige Videos', '04 Freigabe']);

  const creates = g.stats.creates;
  await t.services.drive.ensureProjectFolders(p.id);
  await t.services.drive.ensureCustomerFolder(c.id);
  assert.equal(g.stats.creates, creates, 'erneuter Lauf legt nichts doppelt an');

  // Zweites Projekt im selben Jahr nutzt denselben Jahresordner
  await t.request('POST', '/api/projects', { customer_id: c.id, title: 'Imagefilm', service_month: '2026-12' });
  await flush();
  assert.equal(g.find('2026', customerFolder.id).length, 1);

  const drive = (await t.request('GET', `/api/projects/${p.id}/drive`)).body;
  assert.equal(drive.state, 'bereit');
  assert.deepEqual(drive.folders.map((f: any) => f.role), ['projekt', 'rohmaterial', 'schnitt', 'final', 'freigabe']);
});

test('Upload-Erkennung: Datei in „Fertige Videos“ hakt den Checkpunkt ab', async () => {
  const p = t.db.get<{ id: number }>("SELECT id FROM projects WHERE title = 'Reels November'")!;
  let drive = (await t.request('POST', `/api/projects/${p.id}/drive/check`)).body;
  assert.equal(drive.final_file_count, 0);
  const [final] = g.find('03 Fertige Videos');
  g.addFile('Reel_01_final.mp4', final.id);
  g.addFile('Reel_02_final.mp4', final.id);
  drive = (await t.request('POST', `/api/projects/${p.id}/drive/check`)).body;
  assert.equal(drive.final_file_count, 2);
  assert.ok(drive.final_checked_at);
  assert.deepEqual(drive.final_files.map((f: any) => f.name).sort(), ['Reel_01_final.mp4', 'Reel_02_final.mp4']);
  const project = (await t.request('GET', `/api/projects/${p.id}`)).body;
  const item = project.checklist.find((i: any) => i.auto_key === 'final_files_present');
  assert.equal(item.is_done, 1);
});

test('Bestehende Ordner verknüpfen und vorhandene Unterordner erkennen', async () => {
  const c = (await t.request('POST', '/api/customers', { company_name: 'Bestandskunde', status: 'interessent' })).body;
  const existing = g.addFolder('Bestandskunde alt');
  g.addFolder('Rohmaterial', existing.id);
  g.addFolder('Entwürfe', existing.id);
  const fertig = g.addFolder('Fertige Videos', existing.id);
  g.addFile('Video.mp4', fertig.id);

  const bad = await t.request('POST', `/api/customers/${c.id}/drive/link`, { url: 'https://example.com/irgendwas' });
  assert.equal(bad.status, 400);
  const missing = await t.request('POST', `/api/customers/${c.id}/drive/link`, { url: 'https://drive.google.com/drive/folders/gibtesnicht123' });
  assert.equal(missing.status, 404);

  const linked = await t.request('POST', `/api/customers/${c.id}/drive/link`, { url: `https://drive.google.com/drive/folders/${existing.id}?usp=sharing` });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.folder.origin, 'verknuepft');
  // Umwandlung legt keinen zweiten Ordner an
  await t.request('PUT', `/api/customers/${c.id}`, { company_name: 'Bestandskunde', status: 'aktiv' });
  await flush();
  assert.equal(g.find('Bestandskunde').length, 0);

  const p = (await t.request('POST', '/api/projects', { customer_id: c.id, title: 'Altprojekt' })).body;
  const res = await t.request('POST', `/api/projects/${p.id}/drive/link`, { url: existing.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const roles = res.body.folders.map((f: any) => f.role);
  assert.deepEqual(roles, ['projekt', 'rohmaterial', 'schnitt', 'final'], 'Freigabe-Ordner fehlt und wird nicht angelegt');
  assert.equal(res.body.final_file_count, 1, 'sofort geprüft');
});

test('Fehler und Wiederholung, abgelaufenes Token, Trennen', async () => {
  // Fehler beim Anlegen: Auftrag wird später erneut versucht
  g.stats.failCreateNames.add('Störungs GmbH');
  const c = (await t.request('POST', '/api/customers', { company_name: 'Störungs GmbH' })).body;
  await flush();
  let jobs = (await t.request('GET', '/api/sync/jobs')).body;
  const job = jobs.find((j: any) => j.label.includes('Störungs GmbH'));
  assert.equal(job.status, 'wartend');
  assert.equal(job.attempts, 1);
  assert.match(job.last_error, /500/);
  assert.ok(job.run_after > new Date().toISOString(), 'nächster Versuch später');
  g.stats.failCreateNames.clear();
  await t.request('POST', `/api/sync/jobs/${job.id}/retry`);
  await flush();
  assert.equal((await t.request('GET', `/api/customers/${c.id}/drive`)).body.state, 'bereit');

  // Abgelaufenes Zugriffstoken wird automatisch erneuert
  t.db.run("UPDATE google_accounts SET token_expires_at = '2000-01-01T00:00:00.000Z'");
  const before = g.stats.refreshes;
  const p = t.db.get<{ id: number }>("SELECT id FROM projects WHERE title = 'Reels November'")!;
  await t.request('POST', `/api/projects/${p.id}/drive/check`);
  assert.equal(g.stats.refreshes, before + 1);

  // Zugang bei Google widerrufen: Verbindung wird lokal entfernt, Aufträge warten
  g.stats.revoked = true;
  t.db.run("UPDATE google_accounts SET token_expires_at = '2000-01-01T00:00:00.000Z'");
  const err = await t.request('POST', `/api/projects/${p.id}/drive/check`);
  assert.equal(err.status, 409);
  assert.match(err.body.error, /neu verbinden/);
  assert.equal((await t.request('GET', '/api/google/status')).body.connected, false);
  const lead = (await t.request('POST', '/api/customers', { company_name: 'Ohne Verbindung GmbH' })).body;
  assert.equal((await t.request('GET', `/api/customers/${lead.id}/drive`)).body.state, 'nicht_verbunden', 'ohne Verbindung kein Auftrag');

  const off = await t.request('POST', '/api/google/disconnect');
  assert.equal(off.body.connected, false);
  jobs = (await t.request('GET', '/api/sync/jobs')).body;
  assert.ok(Array.isArray(jobs));
  assert.ok(g.find('Kunden', 'root').length === 1, 'Stammordner nur einmal');
  assert.equal(g.files.size, [...g.files.values()].filter((f) => f.mimeType === FOLDER || f.mimeType === 'video/mp4').length);
});
