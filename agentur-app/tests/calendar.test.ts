import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, type TestApp } from './helpers.ts';
import { startFakeGoogle } from './fake-google.ts';
import { addDays, todayBerlin } from '../server/lib/time.ts';

let t: TestApp;
let g: Awaited<ReturnType<typeof startFakeGoogle>>;
let customerId: number;
let projectId: number;

const sync = async () => {
  const res = await t.request('POST', '/api/calendar/sync');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.last_error, null, res.body.last_error);
  return res.body;
};
const shootEvent = () => g.calendar.find((e) => e.extendedProperties?.private?.linkedType === 'shoot' && e.status !== 'cancelled');
const gateOf = (p: any) => p.checklist.find((i: any) => i.is_gate && i.phase === 2);

before(async () => {
  g = await startFakeGoogle();
  t = await startTestApp({ google: g.google('http://localhost:3000/api/google/callback') });
  // Verbinden
  await t.request('POST', '/api/google/credentials', {
    json: JSON.stringify({ web: { client_id: 'c.apps.googleusercontent.com', client_secret: 'geheim', redirect_uris: [] } }),
  });
  const redirect = await fetch(`${t.url}/api/google/auth`, { redirect: 'manual' });
  const state = new URL(redirect.headers.get('location')!).searchParams.get('state');
  await fetch(`${t.url}/api/google/callback?code=gut&state=${state}`, { redirect: 'manual' });
  assert.equal((await t.request('GET', '/api/google/status')).body.connected, true);

  customerId = (await t.request('POST', '/api/customers', { company_name: 'Pizzeria Roma', customer_type: 'restaurant' })).body.id;
  const p = await t.request('POST', '/api/projects', {
    customer_id: customerId,
    title: 'Reels November',
    shoot_date: '2026-11-10',
    start_time: '09:00',
    end_time: '12:30',
    location: 'Domstraße 12, Köln',
  });
  projectId = p.body.id;
});
after(async () => {
  await t.close();
  await g.close();
});

test('Drehtag wird mit Uhrzeit, Ort und Shotlist in Google Calendar eingetragen', async () => {
  const settings = await sync();
  assert.equal(settings.write_id, 'inhaber@beispiel.de', '"primary" durch echte Kennung ersetzt');
  const ev = shootEvent()!;
  assert.ok(ev, 'Termin angelegt');
  assert.equal(ev.summary, 'Drehtag: Pizzeria Roma – Reels November');
  assert.deepEqual(ev.start, { dateTime: '2026-11-10T09:00:00', timeZone: 'Europe/Berlin' });
  assert.deepEqual(ev.end, { dateTime: '2026-11-10T12:30:00', timeZone: 'Europe/Berlin' });
  assert.equal(ev.location, 'Domstraße 12, Köln');
  assert.equal(ev.colorId, '9');
  assert.match(ev.description!, /Shotlist:\n- Außenansicht und Eingang/);
  assert.match(ev.description!, /\/projekte\/\d+/);
  const state = (await t.request('GET', `/api/projects/${projectId}/calendar`)).body;
  assert.equal(state.state, 'eingetragen');
  assert.ok(state.html_link);
});

test('Änderung in der App aktualisiert den Termin, ohne Änderung kein Aufruf', async () => {
  const before = g.calendar.stats.patches;
  await sync();
  assert.equal(g.calendar.stats.patches, before, 'nichts geändert, nichts übertragen');
  await t.request('PUT', `/api/projects/${projectId}/shoot`, {
    shoot_date: '2026-11-11',
    start_time: '10:00',
    end_time: '13:00',
    location: 'Domstraße 12, Köln',
  });
  await sync();
  assert.equal(g.calendar.stats.patches, before + 1);
  const ev = shootEvent()!;
  assert.equal(ev.start.dateTime, '2026-11-11T10:00:00');
  assert.equal(g.calendar.events().filter((e) => e.status !== 'cancelled').length, 1, 'kein zweiter Termin');
});

test('In Google verschoben: die App übernimmt Datum, Uhrzeit und Ort', async () => {
  const ev = shootEvent()!;
  const patches = g.calendar.stats.patches;
  g.calendar.change(ev.id, {
    start: { dateTime: '2026-11-12T14:00:00+01:00' },
    end: { dateTime: '2026-11-12T16:30:00+01:00' },
    location: 'Neue Filiale, Bonn',
  });
  await sync();
  const p = (await t.request('GET', `/api/projects/${projectId}`)).body;
  assert.equal(p.shoot.shoot_date, '2026-11-12');
  assert.equal(p.shoot.start_time, '14:00');
  assert.equal(p.shoot.end_time, '16:30');
  assert.equal(p.shoot.location, 'Neue Filiale, Bonn');
  assert.equal(p.phases[0].due_date, '2026-11-12', 'Fälligkeit folgt');
  assert.equal(g.calendar.stats.patches, patches, 'übernommener Stand wird nicht zurückgeschrieben');
});

test('In Google gelöscht: Projekt bleibt, Hinweis, erneut eintragen auf Wunsch', async () => {
  const ev = shootEvent()!;
  g.calendar.remove(ev.id);
  await sync();
  assert.equal((await t.request('GET', `/api/projects/${projectId}`)).status, 200);
  assert.equal((await t.request('GET', `/api/projects/${projectId}/calendar`)).body.state, 'in_google_geloescht');
  const creates = g.calendar.stats.creates;
  await sync();
  assert.equal(g.calendar.stats.creates, creates, 'nicht ungefragt neu angelegt');
  await t.request('POST', `/api/projects/${projectId}/calendar/restore`);
  await sync();
  assert.equal(g.calendar.stats.creates, creates + 1);
  assert.equal((await t.request('GET', `/api/projects/${projectId}/calendar`)).body.state, 'eingetragen');
});

test('Fremde Termine: nur aus ausgewählten Kalendern, mit abgelaufenem Sync-Token', async () => {
  g.calendar.addExternal('Steuerberater', { dateTime: '2026-11-11T08:00:00+01:00' }, { dateTime: '2026-11-11T09:00:00+01:00' });
  g.calendar.addExternal('Allerheiligen', { date: '2026-11-01' }, { date: '2026-11-02' }, 'feiertage@group');
  await sync();
  let items = (await t.request('GET', '/api/calendar/items?start=2026-11-01&end=2026-12-01')).body;
  assert.ok(items.some((i: any) => i.kind === 'termin' && i.title === 'Steuerberater'));
  assert.ok(!items.some((i: any) => i.title === 'Allerheiligen'), 'Feiertagskalender nicht ausgewählt');
  assert.ok(!items.some((i: any) => i.kind === 'termin' && i.title.startsWith('Drehtag')), 'App-Termine nicht doppelt');

  const settings = (await t.request('GET', '/api/calendar/settings')).body;
  assert.equal(settings.calendars.length, 2);
  const res = await t.request('PUT', '/api/calendar/settings', {
    write_id: 'inhaber@beispiel.de',
    read_ids: ['inhaber@beispiel.de', 'feiertage@group'],
    push_approvals: false,
    push_publications: false,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const readOnly = await t.request('PUT', '/api/calendar/settings', { write_id: 'feiertage@group', read_ids: [], push_approvals: false, push_publications: false });
  assert.equal(readOnly.status, 400, 'in fremden Kalender nicht schreiben');

  g.calendar.stats.invalidateTokens = true;
  await sync();
  items = (await t.request('GET', '/api/calendar/items?start=2026-11-01&end=2026-12-01')).body;
  assert.ok(items.some((i: any) => i.title === 'Allerheiligen'));
  assert.ok(items.some((i: any) => i.title === 'Steuerberater'), 'nach vollständigem Neuladen noch da');

  // Kundenfilter blendet fremde Termine aus
  const forCustomer = (await t.request('GET', `/api/calendar/items?start=2026-11-01&end=2026-12-01&customer_id=${customerId}`)).body;
  assert.ok(forCustomer.every((i: any) => i.kind !== 'termin'));
});

test('Kalenderansicht: alle Arten, Verschieben in der App, Freigabe-Fristen optional in Google', async () => {
  const p2 = (await t.request('POST', '/api/projects', { customer_id: customerId, title: 'Imagefilm', shoot_date: '2026-11-03' })).body;
  await t.request('PATCH', `/api/checklist/${gateOf(p2).id}`, { is_done: true });
  await t.request('POST', `/api/projects/${p2.id}/move`, { to_phase: 4 });
  // Anfrage von gestern (ein Datum in der Zukunft lehnt die App ab)
  const requested = addDays(todayBerlin(), -1);
  assert.equal((await t.request('PUT', `/api/projects/${p2.id}/approval`, { requested_date: requested })).status, 200);
  await t.request('POST', `/api/projects/${projectId}/publications`, { platform: 'instagram', planned_date: '2026-11-20', planned_time: '18:00' });
  await t.request('POST', '/api/tasks', { title: 'Musik lizenzieren', project_id: projectId, due_date: '2026-11-14' });

  const items = (await t.request('GET', '/api/calendar/items?start=2026-11-01&end=2026-12-01')).body;
  const kinds = new Set(items.map((i: any) => i.kind));
  for (const k of ['drehtag', 'deadline', 'freigabe', 'veroeffentlichung', 'termin']) assert.ok(kinds.has(k), k);
  const around = (await t.request('GET', `/api/calendar/items?start=${addDays(requested, -1)}&end=${addDays(requested, 10)}`)).body;
  const approval = around.find((i: any) => i.kind === 'freigabe');
  assert.equal(approval.start, addDays(requested, 3), 'Anfrage plus 3 Tage');
  assert.equal(approval.editable, false);
  const pub = items.find((i: any) => i.kind === 'veroeffentlichung');
  assert.equal(pub.start, '2026-11-20T18:00');
  const task = items.find((i: any) => i.id.startsWith('task:'));

  // Verschieben in der App-Ansicht
  await t.request('POST', '/api/calendar/move', { id: task.id, start: '2026-11-15', all_day: true });
  await t.request('POST', '/api/calendar/move', { id: pub.id, start: '2026-11-21T19:30', end: '2026-11-21T20:00', all_day: false });
  await t.request('POST', '/api/calendar/move', { id: `shoot:${projectId}`, start: '2026-11-13T09:00', end: '2026-11-13T11:00', all_day: false });
  const moved = (await t.request('GET', '/api/calendar/items?start=2026-11-01&end=2026-12-01')).body;
  assert.equal(moved.find((i: any) => i.id === task.id).start, '2026-11-15');
  assert.equal(moved.find((i: any) => i.id === pub.id).start, '2026-11-21T19:30');
  assert.equal(moved.find((i: any) => i.id === `shoot:${projectId}`).start, '2026-11-13T09:00');
  const bad = await t.request('POST', '/api/calendar/move', { id: approval.id, start: '2026-11-25', all_day: true });
  assert.equal(bad.status, 400);

  // Optional: Freigabe-Fristen und Veröffentlichungen nach Google
  await t.request('PUT', '/api/calendar/settings', { write_id: 'inhaber@beispiel.de', read_ids: ['inhaber@beispiel.de'], push_approvals: true, push_publications: true });
  await sync();
  assert.ok(g.calendar.find((e) => e.summary === 'Freigabe-Frist: Pizzeria Roma – Imagefilm' && e.status !== 'cancelled'));
  assert.ok(g.calendar.find((e) => e.summary === 'Veröffentlichung Instagram: Pizzeria Roma – Reels November' && e.status !== 'cancelled'));
  assert.equal(shootEvent()!.start.dateTime, '2026-11-13T09:00:00', 'in der App verschobener Drehtag übertragen');
  await t.request('PUT', '/api/calendar/settings', { write_id: 'inhaber@beispiel.de', read_ids: ['inhaber@beispiel.de'], push_approvals: false, push_publications: false });
  await sync();
  assert.ok(!g.calendar.find((e) => !!e.summary?.startsWith('Freigabe-Frist') && e.status !== 'cancelled'), 'wieder entfernt');
});

test('Abgebrochenes Projekt: Drehtag verschwindet aus Google', async () => {
  const p = (await t.request('GET', `/api/projects/${projectId}`)).body;
  await t.request('PUT', `/api/projects/${projectId}`, {
    title: p.title,
    deliverable_type_id: p.deliverable_type_id,
    deliverable_count: p.deliverable_count,
    service_month: p.service_month,
    priority: p.priority,
    status: 'abgebrochen',
  });
  await sync();
  assert.ok(!g.calendar.find((e) => e.summary === 'Drehtag: Pizzeria Roma – Reels November' && e.status !== 'cancelled'));
});

test('Tagesgrenzen in Berliner Zeit, Termine anderer Installationen, App-Stand gewinnt', async () => {
  await t.request('PUT', '/api/calendar/settings', { write_id: 'inhaber@beispiel.de', read_ids: ['inhaber@beispiel.de'], push_approvals: false, push_publications: false });
  g.calendar.addExternal('Nachttermin', { dateTime: '2026-11-12T00:30:00+01:00' }, { dateTime: '2026-11-12T01:30:00+01:00' });
  g.calendar.addExternal('Ganztags', { date: '2026-11-12' }, { date: '2026-11-13' });

  // Termin einer anderen Installation (z. B. alte Datenbank auf einem anderen Rechner)
  const token = await t.services.google.accessToken();
  const foreign = await fetch(`${g.base}/calendar/v3/calendars/primary/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: 'Drehtag: Alte Installation',
      start: { dateTime: '2026-11-20T10:00:00', timeZone: 'Europe/Berlin' },
      end: { dateTime: '2026-11-20T12:00:00', timeZone: 'Europe/Berlin' },
      extendedProperties: { private: { agenturApp: '1', agenturInstall: 'andere', linkedType: 'shoot', linkedId: '999' } },
    }),
  }).then((r) => r.json() as Promise<{ id: string }>);
  await sync();
  const titles = async (start: string, end: string) =>
    (await t.request('GET', `/api/calendar/items?start=${start}&end=${end}`)).body.map((i: any) => i.title);
  assert.ok(!(await titles('2026-11-11', '2026-11-12')).includes('Nachttermin'), '00:30 Uhr gehört nicht zum Vortag');
  assert.ok(!(await titles('2026-11-11', '2026-11-12')).includes('Ganztags'));
  assert.deepEqual((await titles('2026-11-12', '2026-11-13')).filter((x: string) => ['Nachttermin', 'Ganztags'].includes(x)).sort(), ['Ganztags', 'Nachttermin']);
  assert.equal(g.calendar.find((e) => e.id === foreign.id)!.status, 'confirmed', 'fremder App-Termin nicht gelöscht');
  assert.ok((await titles('2026-11-20', '2026-11-21')).includes('Drehtag: Alte Installation'), 'als fremder Termin sichtbar');

  // Drehtag in Google verschoben, danach in der App unverändert gespeichert: App-Stand gewinnt und landet in Google
  const p = (await t.request('POST', '/api/projects', { customer_id: customerId, title: 'Gewinner', shoot_date: '2026-11-25', start_time: '09:00', end_time: '11:00' })).body;
  await sync();
  const ev = g.calendar.find((e) => e.extendedProperties?.private?.linkedId === String(p.id) && e.status !== 'cancelled')!;
  g.calendar.change(ev.id, { start: { dateTime: '2026-11-26T09:00:00+01:00' }, end: { dateTime: '2026-11-26T11:00:00+01:00' } });
  // Der Testserver stempelt Änderungen leicht in der Zukunft: warten, bis die App-Änderung sicher jünger ist
  await new Promise((r) => setTimeout(r, Math.max(5, Date.parse(g.calendar.find((e) => e.id === ev.id)!.updated) - Date.now() + 20)));
  await t.request('PUT', `/api/projects/${p.id}/shoot`, { shoot_date: '2026-11-25', start_time: '09:00', end_time: '11:00', location: null });
  await sync();
  assert.equal(g.calendar.find((e) => e.id === ev.id)!.start.dateTime, '2026-11-25T09:00:00', 'Google zeigt wieder den App-Stand');
  const shoot = (await t.request('GET', `/api/projects/${p.id}`)).body.shoot;
  assert.equal(shoot.shoot_date, '2026-11-25');
});

test('„Jetzt abgleichen“ wartet nicht auf die Pause nach Fehlversuchen', async () => {
  t.db.run("UPDATE sync_jobs SET status = 'fertig' WHERE status = 'wartend'");
  t.db.run("INSERT INTO sync_jobs (job_type, payload_json, attempts, run_after) VALUES ('calendar.sync', ?, 5, ?)", [
    JSON.stringify({ label: 'Kalender abgleichen' }),
    new Date(Date.now() + 6 * 3600000).toISOString(),
  ]);
  const before = t.db.get<{ n: string }>("SELECT value_json AS n FROM settings WHERE key = 'calendar_last_sync'")?.n;
  await new Promise((r) => setTimeout(r, 5));
  await sync();
  const after = t.db.get<{ n: string }>("SELECT value_json AS n FROM settings WHERE key = 'calendar_last_sync'")?.n;
  assert.notEqual(after, before, 'Abgleich lief sofort');
});
