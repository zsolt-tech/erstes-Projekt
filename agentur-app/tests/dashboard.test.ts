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

test('Dashboard: Kennzahlen, Phasen, heute, 14 Tage und Durchlaufzeit', async () => {
  const c = (await t.request('POST', '/api/customers', { company_name: 'Pizzeria Roma', customer_type: 'restaurant' })).body;
  const archived = (await t.request('POST', '/api/customers', { company_name: 'Alt GmbH' })).body;
  const mk = async (title: string, shoot_date: string, customer = c.id) =>
    (await t.request('POST', '/api/projects', { customer_id: customer, title, shoot_date, start_time: '10:00' })).body;

  // Durchlaufzeit: zwei veröffentlichte Projekte (10 und 21 Tage), eines außerhalb der 90 Tage
  const p1 = await mk('Reels A', addDays(today, -20));
  const p2 = await mk('Reels B', addDays(today, -30));
  const old = await mk('Alt', addDays(today, -200));
  t.db.run("INSERT INTO publications (project_id, platform, planned_date, status) VALUES (?, 'instagram', ?, 'veroeffentlicht')", [p1.id, addDays(today, -10)]);
  t.db.run("INSERT INTO publications (project_id, platform, planned_date, status) VALUES (?, 'tiktok', ?, 'veroeffentlicht')", [p1.id, addDays(today, -5)]);
  t.db.run("INSERT INTO publications (project_id, platform, published_at, status) VALUES (?, 'instagram', ?, 'veroeffentlicht')", [p2.id, `${addDays(today, -9)}T10:00:00.000Z`]);
  // Link erst heute eingetragen, geplant war vor 12 Tagen: gilt ab dem geplanten Tag
  const p2b = await mk('Reels C', addDays(today, -15));
  t.db.run("INSERT INTO publications (project_id, platform, planned_date, published_at, status) VALUES (?, 'instagram', ?, ?, 'veroeffentlicht')", [p2b.id, addDays(today, -12), new Date().toISOString()]);
  t.db.run("INSERT INTO publications (project_id, platform, planned_date, status) VALUES (?, 'instagram', ?, 'veroeffentlicht')", [old.id, addDays(today, -150)]);
  for (const p of [p1, p2, p2b, old]) t.db.run("UPDATE projects SET status = 'abgeschlossen', current_phase = 5, completed_at = ? WHERE id = ?", [new Date().toISOString(), p.id]);

  // Bearbeitung überfällig, Drehtag heute und in drei Tagen, überfällige Aufgabe
  const p3 = await mk('Imagefilm', addDays(today, -6));
  await t.request('POST', `/api/projects/${p3.id}/move`, { to_phase: 2 });
  await t.request('PUT', `/api/projects/${p3.id}/phases/2`, { due_date: addDays(today, -1), assignee_id: null, notes: null });
  await mk('Dreh heute', today);
  await mk('Dreh bald', addDays(today, 3));
  await t.request('POST', '/api/tasks', { title: 'Angebot schicken', customer_id: c.id, due_date: addDays(today, -2) });
  // Archivierter Kunde zählt nicht mit
  await mk('Archiviert', addDays(today, 2), archived.id);
  await t.request('POST', '/api/tasks', { title: 'Alte Aufgabe', customer_id: archived.id, due_date: addDays(today, -3) });
  await t.request('POST', `/api/customers/${archived.id}/archive`);

  const res = await t.request('GET', '/api/dashboard');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const d = res.body;
  assert.equal(d.date, today);
  assert.equal(d.kpis.active_projects, 3, 'ohne abgeschlossene und ohne Projekte archivierter Kunden');
  assert.equal(d.kpis.overdue_tasks, 1);
  assert.equal(d.kpis.overdue_deadlines, 1);
  assert.equal(d.kpis.shoots_next_7, 1, 'morgen bis in 7 Tagen, heute zählt unter Heute');
  assert.deepEqual(d.phases.map((p: any) => p.count), [2, 1, 0, 0, 0]);
  assert.equal(d.phases[1].overdue, 1);

  assert.equal(d.lead_time.count, 3);
  assert.equal(d.lead_time.avg_days, 11.3);
  assert.equal(d.lead_time.median_days, 10);
  assert.deepEqual(d.lead_time.projects.map((p: any) => [p.title, p.days]).sort(), [['Reels A', 10], ['Reels B', 21], ['Reels C', 3]]);

  assert.ok(d.today.some((i: any) => i.kind === 'drehtag' && i.title.includes('Dreh heute')));
  assert.ok(d.upcoming.some((i: any) => i.kind === 'drehtag' && i.title.includes('Dreh bald')));
  assert.ok(!d.upcoming.some((i: any) => i.title.includes('Dreh heute')), 'heute nicht doppelt');
  assert.equal(d.projects[0].title, 'Imagefilm', 'Überfälliges zuerst');
  assert.ok(Array.isArray(d.warnings));
});
