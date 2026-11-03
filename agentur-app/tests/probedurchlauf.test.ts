// Funde aus dem Probedurchlauf
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, type TestApp } from './helpers.ts';
import { addDays, todayBerlin } from '../server/lib/time.ts';

let t: TestApp;
const today = todayBerlin();
before(async () => {
  t = await startTestApp();
});
after(async () => {
  await t.close();
});

const due = (p: any) => Object.fromEntries(p.phases.map((ph: any) => [ph.phase, ph.due_date]));

test('Phasenfristen folgen dem Drehtag (nachträglich eingetragen und verschoben)', async () => {
  const c = (await t.request('POST', '/api/customers', { company_name: 'Fahrschule Blitz', customer_type: 'fahrschule' })).body;
  // Ohne Drehtag angelegt: keine Fristen
  let p = (await t.request('POST', '/api/projects', { customer_id: c.id, title: 'Theorie-Reels' })).body;
  assert.equal(due(p)[3], null);
  p = (await t.request('PUT', `/api/projects/${p.id}/shoot`, { shoot_date: '2026-12-01', start_time: '10:00' })).body;
  const first = due(p);
  assert.equal(first[1], '2026-12-01');
  assert.ok(first[2] && first[5] && first[2] > '2026-12-01', 'Fristen aus der Vorlage gesetzt');

  // Verschoben: alle offenen Fristen wandern mit
  p = (await t.request('PUT', `/api/projects/${p.id}/shoot`, { shoot_date: '2026-12-15', start_time: '10:00' })).body;
  const moved = due(p);
  for (const ph of [2, 3, 4, 5]) assert.equal(moved[ph], addDays(first[ph], 14), `Phase ${ph}`);

  // Auch beim Ziehen im Kalender
  await t.request('POST', '/api/calendar/move', { id: `shoot:${p.id}`, start: '2026-12-10T09:00', end: '2026-12-10T11:00', all_day: false });
  p = (await t.request('GET', `/api/projects/${p.id}`)).body;
  assert.equal(due(p)[1], '2026-12-10');
  assert.equal(due(p)[2], addDays(first[2], 9));
});

test('Kunde: Speichern aus einem veralteten Fenster überschreibt nichts', async () => {
  const c = (await t.request('POST', '/api/customers', { company_name: 'Pizzeria Roma', contacts: [{ name: 'Marco Rossi' }] })).body;
  const opened = c.updated_at;
  await new Promise((r) => setTimeout(r, 5));
  // Fenster B fügt einen Kontakt hinzu
  const b = await t.request('PUT', `/api/customers/${c.id}`, { company_name: 'Pizzeria Roma', contacts: [{ name: 'Marco Rossi' }, { name: 'Mario Rossi' }], expected_updated_at: opened });
  assert.equal(b.status, 200);
  // Fenster A speichert mit dem alten Stand
  const a = await t.request('PUT', `/api/customers/${c.id}`, { company_name: 'Pizzeria Roma', notes: 'Neu', contacts: [{ name: 'Marco Rossi' }], expected_updated_at: opened });
  assert.equal(a.status, 409);
  assert.match(a.body.error, /anderen Fenster/);
  assert.equal((await t.request('GET', `/api/customers/${c.id}`)).body.contacts.length, 2, 'Kontakt aus Fenster B bleibt');
});

test('Suche ignoriert Groß- und Kleinschreibung auch bei Umlauten', async () => {
  await t.request('POST', '/api/customers', { company_name: 'Ünal-Çelik Ößchen GmbH' });
  for (const q of ['ünal', 'ÜNAL', 'çelik', 'ößchen', 'ÖSSCHEN'.toLowerCase().replace('ss', 'ß')]) {
    const r = (await t.request('GET', `/api/customers?q=${encodeURIComponent(q)}`)).body;
    assert.ok(r.some((c: any) => c.company_name.startsWith('Ünal')), `Suche nach ${q}`);
  }
});

test('Freigabe: Anfragedatum nicht in der Zukunft, Briefing zählt vergessene Drehtage als überfällig', async () => {
  const c = (await t.request('POST', '/api/customers', { company_name: 'Elektro Schmidt' })).body;
  const p = (await t.request('POST', '/api/projects', { customer_id: c.id, title: 'Baustellen-Reel', shoot_date: addDays(today, -10) })).body;
  // Drehtag vor 10 Tagen, Projekt steht noch im Drehtag
  const b = (await t.request('POST', '/api/briefing/generate', { deliver: false })).body;
  assert.ok(b.data.overdue.some((o: any) => o.title === 'Drehtag: Baustellen-Reel'), 'vergessener Drehtag ist überfällig');
  const d = (await t.request('GET', '/api/dashboard')).body;
  assert.equal(d.kpis.overdue_deadlines, d.overdue.filter((o: any) => !o.title.startsWith('Aufgabe:')).length, 'Dashboard-Zahl passt zur Liste');

  const gate = p.checklist.find((i: any) => i.is_gate);
  await t.request('PATCH', `/api/checklist/${gate.id}`, { is_done: true });
  await t.request('POST', `/api/projects/${p.id}/move`, { to_phase: 4 });
  const future = await t.request('PUT', `/api/projects/${p.id}/approval`, { requested_date: addDays(today, 3) });
  assert.equal(future.status, 400);
  assert.equal((await t.request('PUT', `/api/projects/${p.id}/approval`, { requested_date: addDays(today, -1) })).status, 200);

  // Highlight-Länge außerhalb 5 bis 600 Sekunden
  assert.equal((await t.request('GET', `/api/projects/${p.id}/agent-prompt?kind=highlight&dauer=9999`)).status, 400);
  assert.equal((await t.request('GET', `/api/projects/${p.id}/agent-prompt?kind=highlight&dauer=0`)).status, 400);
  assert.equal((await t.request('GET', `/api/projects/${p.id}/agent-prompt?kind=highlight&dauer=45`)).status, 200);
});
