import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, type TestApp } from './helpers.ts';
import { startFakeGoogle } from './fake-google.ts';
import { addDays, todayBerlin } from '../server/lib/time.ts';
import { detectBottlenecks } from '../server/services/bottlenecks.ts';

let t: TestApp;
let g: Awaited<ReturnType<typeof startFakeGoogle>>;
const today = todayBerlin();
const gateOf = (p: any) => p.checklist.find((i: any) => i.is_gate && i.phase === 2);
let roma: any;
let waitingProject: any;

before(async () => {
  g = await startFakeGoogle();
  t = await startTestApp({ google: g.google('http://localhost:3000/api/google/callback') });
  await t.request('POST', '/api/google/credentials', {
    json: JSON.stringify({ web: { client_id: 'c.apps.googleusercontent.com', client_secret: 'geheim', redirect_uris: [] } }),
  });
  const redirect = await fetch(`${t.url}/api/google/auth`, { redirect: 'manual' });
  const state = new URL(redirect.headers.get('location')!).searchParams.get('state');
  await fetch(`${t.url}/api/google/callback?code=gut&state=${state}`, { redirect: 'manual' });

  const types = (await t.request('GET', '/api/deliverable-types')).body;
  const reel = types.find((x: any) => x.name === 'Reel').id;
  roma = (await t.request('POST', '/api/customers', {
    company_name: 'Pizzeria Roma',
    customer_type: 'restaurant',
    contacts: [{ name: 'Marco Rossi', email: 'marco@roma.de' }],
    package_items: [{ deliverable_type_id: reel, quantity_per_month: 4, valid_from: '2026-01-01' }],
  })).body;
  // Drehtag heute, Drehtag übermorgen
  await t.request('POST', '/api/projects', { customer_id: roma.id, title: 'Reels heute', shoot_date: today, start_time: '09:00', location: 'Köln' });
  await t.request('POST', '/api/projects', { customer_id: roma.id, title: 'Reels bald', shoot_date: addDays(today, 2), start_time: '14:00' });
  // Wartet seit 5 Tagen auf Freigabe
  waitingProject = (await t.request('POST', '/api/projects', { customer_id: roma.id, title: 'Imagefilm' })).body;
  await t.request('PATCH', `/api/checklist/${gateOf(waitingProject).id}`, { is_done: true });
  await t.request('POST', `/api/projects/${waitingProject.id}/move`, { to_phase: 4 });
  await t.request('PUT', `/api/projects/${waitingProject.id}/approval`, { requested_date: addDays(today, -5) });
  // Aufgaben: heute, überfällig
  await t.request('POST', '/api/tasks', { title: 'Musik lizenzieren', customer_id: roma.id, due_date: today });
  await t.request('POST', '/api/tasks', { title: 'Rechnung schreiben', customer_id: roma.id, due_date: addDays(today, -3) });
});
after(async () => {
  await t.close();
  await g.close();
});

test('Briefing enthält Termine, Fälliges, Überfälliges, Freigaben, Drehtage und Paket', async () => {
  const res = await t.request('GET', '/api/briefing/today');
  assert.equal(res.body.briefing, null, 'noch keins gespeichert');
  const d = res.body.preview;
  assert.equal(d.date, today);
  assert.ok(d.appointments.some((a: any) => a.title === 'Drehtag: Pizzeria Roma – Reels heute' && a.time === '09:00'));
  assert.ok(d.due_today.some((x: any) => x.title === 'Aufgabe: Musik lizenzieren'));
  const overdue = d.overdue.find((x: any) => x.title === 'Aufgabe: Rechnung schreiben');
  assert.equal(overdue.days, 3);
  const approval = d.approvals.find((a: any) => a.title === 'Imagefilm');
  assert.equal(approval.waiting_days, 5);
  assert.equal(approval.follow_up, true, 'Standardfrist 3 Tage überschritten');
  assert.deepEqual(d.shoots.map((s: any) => s.title), ['Reels bald'], 'heutiger Drehtag steht bei den Terminen');
  assert.equal(d.packages[0].customer, 'Pizzeria Roma');
  assert.match(d.summary, /Heute 1 Termin, 1 heute fällig, 1 überfällig\./);
  assert.match(d.summary, /1 Freigabe offen, 1 zum Nachfassen\./);
  assert.match(d.summary, /1 Drehtag in den nächsten 7 Tagen\./);
});

test('Erzeugen: gespeichert, Benachrichtigung, E-Mail über Gmail', async () => {
  await t.request('PUT', '/api/settings', { briefing_email_enabled: true, briefing_email_to: '' });
  const res = await t.request('POST', '/api/briefing/generate', { deliver: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.briefing_date, today);
  assert.ok(res.body.notified_at && res.body.emailed_at);
  assert.match(res.body.text, /Warten auf Freigabe\n- Imagefilm \(Pizzeria Roma\), seit 5 Tagen, nachfassen/);

  await t.services.queue.process();
  assert.equal(g.mails.length, 1);
  const mail = g.mails[0].decoded;
  assert.match(mail, /^To: inhaber@beispiel\.de/m, 'ohne eigene Adresse an das Google-Konto');
  assert.match(mail, /^Subject: =\?UTF-8\?B\?/m, 'Betreff UTF-8-kodiert');
  assert.match(mail, /multipart\/alternative/);
  const html = Buffer.from(mail.split('Content-Type: text/html; charset="UTF-8"')[1].split('\r\n\r\n')[1].split('--agentur')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(html, /Briefing für/);
  assert.match(html, /Pizzeria Roma/);

  const notes = (await t.request('GET', '/api/notifications')).body;
  assert.equal(notes.unread, 1);
  assert.equal(notes.items[0].type, 'briefing');
  const stored = (await t.request('GET', '/api/briefing/today')).body;
  assert.equal(stored.briefing.data.summary, res.body.data.summary);
  assert.equal(stored.preview.summary, res.body.data.summary, 'aktueller Stand wird immer mitgeliefert');
});

test('Fälligkeit: einmal täglich ab der eingestellten Uhrzeit', () => {
  const b = t.services.briefing;
  assert.equal(b.isDue(), false, 'heute schon erzeugt');
  t.db.run('DELETE FROM briefings');
  // 07:30 UTC = 08:30 Berlin (Winterzeit): vor 9:00 nicht fällig
  assert.equal(b.isDue(new Date(`${today}T07:30:00Z`)), false);
  assert.equal(b.isDue(new Date(`${today}T08:01:00Z`)), true);
});

test('Freigabe-Erinnerung: einmal je Frist, nur tagsüber', async () => {
  const b = t.services.briefing;
  assert.equal(b.remindApprovals(new Date(`${today}T05:00:00Z`)), 0, 'nachts keine Erinnerung');
  assert.equal(b.remindApprovals(new Date(`${today}T10:00:00Z`)), 1);
  assert.equal(b.remindApprovals(new Date(`${today}T11:00:00Z`)), 0, 'nicht zweimal');
  const notes = (await t.request('GET', '/api/notifications')).body;
  const reminder = notes.items.find((n: any) => n.type === 'freigabe_erinnerung');
  assert.equal(reminder.title, 'Freigabe nachfassen: Imagefilm');
  assert.match(reminder.body, /seit 5 Tagen/);
  assert.match(reminder.body, /Ansprechpartner: Marco Rossi/);
  const round = t.db.get<{ reminder_count: number }>('SELECT reminder_count FROM approval_rounds WHERE project_id = ?', [waitingProject.id])!;
  assert.equal(round.reminder_count, 1);
  // Nach weiteren 3 Tagen erneut
  assert.equal(b.remindApprovals(new Date(`${addDays(today, 3)}T10:00:00Z`)), 1);

  const read = await t.request('POST', '/api/notifications/read-all');
  assert.equal(read.body.unread, 0);
});

test('Engpässe: zu lange in Bearbeitung, verpasster Drehtag, viele Drehtage, Paket-Rückstand', async () => {
  const p = (await t.request('POST', '/api/projects', { customer_id: roma.id, title: 'Hängt fest' })).body;
  await t.request('POST', `/api/projects/${p.id}/move`, { to_phase: 2 });
  t.db.run('UPDATE project_phases SET entered_at = ? WHERE project_id = ? AND phase = 2', [new Date(Date.now() - 8 * 86400000).toISOString(), p.id]);
  const missed = (await t.request('POST', '/api/projects', { customer_id: roma.id, title: 'Verpasst', shoot_date: addDays(today, -2) })).body;
  for (let i = 3; i <= 5; i++) await t.request('POST', '/api/projects', { customer_id: roma.id, title: `Dreh ${i}`, shoot_date: addDays(today, i) });

  const list = (await t.request('GET', '/api/bottlenecks')).body;
  assert.ok(list.some((b: any) => b.key === `phase:${p.id}:2` && /seit 8 Tagen in Bearbeitung/.test(b.text)));
  assert.ok(list.some((b: any) => b.key === `drehtag:${missed.id}`));
  assert.ok(list.some((b: any) => b.kind === 'auslastung' && /Drehtage in den nächsten 7 Tagen/.test(b.text)));

  // Paket-Rückstand am 25. eines Monats ohne Projekte
  const empty = (await t.request('POST', '/api/customers', {
    company_name: 'Fahrschule Blitz',
    package_items: [{ deliverable_type_id: 1, quantity_per_month: 4, valid_from: '2026-01-01' }],
  })).body;
  const late = detectBottlenecks(t.db, '2026-12-25');
  assert.ok(late.some((b) => b.kind === 'paket' && b.url === `/kunden/${empty.id}` && /erst 0 von 4/.test(b.text)));
  const early = detectBottlenecks(t.db, '2026-12-05');
  assert.ok(!early.some((b) => b.kind === 'paket' && b.url === `/kunden/${empty.id}`));
});
