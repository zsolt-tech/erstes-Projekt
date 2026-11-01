import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, type TestApp } from './helpers.ts';
import { computeProgress } from '../server/services/projects.ts';
import { monthBerlin, todayBerlin } from '../server/lib/time.ts';

let t: TestApp;
let customerId: number;
let reelTypeId: number;

before(async () => {
  t = await startTestApp();
  const types = await t.request('GET', '/api/deliverable-types');
  reelTypeId = types.body.find((d: any) => d.name === 'Reel').id;
  const c = await t.request('POST', '/api/customers', {
    company_name: 'Pizzeria Roma',
    customer_type: 'restaurant',
    package_items: [{ deliverable_type_id: reelTypeId, quantity_per_month: 4, valid_from: '2026-01-01' }],
  });
  customerId = c.body.id;
});
after(async () => {
  await t.close();
});

const gateOf = (p: any) => p.checklist.find((i: any) => i.is_gate && i.phase === 2);

test('Vorlagen sind angelegt, je Kundentyp eine', async () => {
  const res = await t.request('GET', '/api/project-templates');
  const names = res.body.map((x: any) => x.name);
  for (const n of ['Standard', 'Restaurant / Gastronomie', 'Handwerk', 'Arztpraxis', 'Fahrschule']) assert.ok(names.includes(n), n);
  const restaurant = res.body.find((x: any) => x.customer_type === 'restaurant');
  assert.ok(restaurant.items.some((i: any) => i.kind === 'shot'));
  assert.ok(restaurant.items.some((i: any) => i.kind === 'equipment'));
});

test('Projekt anlegen: Vorlage nach Kundentyp, Fristen ab Drehtag, Systempunkte', async () => {
  const res = await t.request('POST', '/api/projects', {
    customer_id: customerId,
    title: 'Reels November',
    shoot_date: '2026-11-10',
    start_time: '09:00',
    end_time: '12:00',
    location: 'Domstraße 12, Köln',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const p = res.body;
  assert.equal(p.template_name, 'Restaurant / Gastronomie');
  assert.equal(p.deliverable_type_name, 'Reel');
  assert.equal(p.deliverable_count, 4, 'Anzahl aus der Vorlage');
  assert.equal(p.service_month, '2026-11', 'Leistungsmonat aus dem Drehdatum');
  assert.equal(p.current_phase, 1);
  assert.deepEqual(
    p.phases.map((x: any) => x.due_date),
    ['2026-11-10', '2026-11-13', '2026-11-15', '2026-11-16', '2026-11-22'],
  );
  assert.equal(p.shoot.location, 'Domstraße 12, Köln');
  const gate = gateOf(p);
  assert.equal(gate.label, 'Clip-Qualitätsprüfung abgeschlossen');
  assert.equal(gate.is_system, 1);
  assert.ok(p.checklist.some((i: any) => i.auto_key === 'final_files_present' && i.phase === 3));
  assert.equal(p.progress, 0);
  assert.equal(p.transitions.length, 1);
});

test('Sperre: ohne Clip-Qualitätsprüfung kein Weiterrücken über die Bearbeitung hinaus', async () => {
  const p = (await t.request('POST', '/api/projects', { customer_id: customerId, title: 'Sperrtest' })).body;
  const toEdit = await t.request('POST', `/api/projects/${p.id}/move`, { to_phase: 2 });
  assert.equal(toEdit.status, 200);
  assert.equal(toEdit.body.current_phase, 2);
  assert.equal(toEdit.body.progress, 20);

  const blocked = await t.request('POST', `/api/projects/${p.id}/move`, { to_phase: 3 });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Clip-Qualitätsprüfung abgeschlossen/);

  // Überspringen ist ebenfalls gesperrt
  const skip = await t.request('POST', `/api/projects/${p.id}/move`, { to_phase: 5 });
  assert.equal(skip.status, 409);

  // Systempunkt lässt sich nicht löschen
  const del = await t.request('DELETE', `/api/checklist/${gateOf(toEdit.body).id}`);
  assert.equal(del.status, 409);

  const checked = await t.request('PATCH', `/api/checklist/${gateOf(toEdit.body).id}`, { is_done: true });
  assert.ok(checked.body.progress > 20, 'Fortschritt steigt anteilig');
  const moved = await t.request('POST', `/api/projects/${p.id}/move`, { to_phase: 3 });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.current_phase, 3);
  assert.ok(moved.body.phases[1].completed_at, 'Bearbeitung als erledigt markiert');
});

test('Freigabe: Runde öffnet automatisch, Korrektur zählt und schiebt zurück, Freigabe führt zur Veröffentlichung', async () => {
  let p = (await t.request('POST', '/api/projects', { customer_id: customerId, title: 'Freigabetest' })).body;
  await t.request('PATCH', `/api/checklist/${gateOf(p).id}`, { is_done: true });
  p = (await t.request('POST', `/api/projects/${p.id}/move`, { to_phase: 4 })).body;
  assert.equal(p.current_phase, 4);
  assert.equal(p.approval_rounds.length, 1);
  assert.equal(p.approval_rounds[0].responded_at, null);
  assert.equal(p.approval_waiting_days, 0);
  assert.ok(p.phases[0].completed_at && p.phases[1].completed_at && p.phases[2].completed_at, 'übersprungene Phasen erledigt');

  // Anfragedatum nachträglich ändern -> Wartezeit
  p = (await t.request('PUT', `/api/projects/${p.id}/approval`, { requested_date: '2026-10-20' })).body;
  assert.ok(p.approval_waiting_days >= 12);

  // Korrektur: zurück in Bearbeitung, Qualitätsprüfung zurückgesetzt
  p = (await t.request('POST', `/api/projects/${p.id}/approval`, { result: 'korrektur', feedback: 'Musik leiser' })).body;
  assert.equal(p.current_phase, 2);
  assert.equal(p.correction_count, 1);
  assert.equal(gateOf(p).is_done, 0, 'Qualitätsprüfung muss erneut abgehakt werden');
  assert.equal(p.transitions[0].reason, 'Korrekturschleife 1');

  // Zweite Runde
  await t.request('PATCH', `/api/checklist/${gateOf(p).id}`, { is_done: true });
  p = (await t.request('POST', `/api/projects/${p.id}/move`, { to_phase: 4 })).body;
  assert.equal(p.approval_rounds.length, 2);
  assert.equal(p.approval_rounds[0].round_no, 2);

  // Kleine Korrektur ohne Schnittdurchlauf: bleibt in Freigabe, Runde 3 startet
  p = (await t.request('POST', `/api/projects/${p.id}/approval`, { result: 'korrektur', back_to_editing: false })).body;
  assert.equal(p.current_phase, 4);
  assert.equal(p.correction_count, 2);
  assert.equal(p.approval_rounds[0].round_no, 3);

  p = (await t.request('POST', `/api/projects/${p.id}/approval`, { result: 'freigegeben' })).body;
  assert.equal(p.current_phase, 5);
  assert.equal(p.approval_rounds[0].result, 'freigegeben');

  const again = await t.request('POST', `/api/projects/${p.id}/approval`, { result: 'freigegeben' });
  assert.equal(again.status, 409);
});

test('Veröffentlichungen: Abschluss automatisch, wenn alle Links eingetragen sind', async () => {
  let p = (await t.request('POST', '/api/projects', { customer_id: customerId, title: 'Veröffentlichungstest' })).body;
  await t.request('PATCH', `/api/checklist/${gateOf(p).id}`, { is_done: true });
  p = (await t.request('POST', `/api/projects/${p.id}/move`, { to_phase: 5 })).body;
  p = (await t.request('POST', `/api/projects/${p.id}/publications`, { platform: 'instagram', planned_date: '2026-11-20' })).body;
  p = (await t.request('POST', `/api/projects/${p.id}/publications`, { platform: 'tiktok', planned_date: '2026-11-21' })).body;
  assert.equal(p.publications.length, 2);
  assert.equal(p.next_publication_date, '2026-11-20');

  const [insta, tiktok] = p.publications;
  p = (await t.request('PUT', `/api/publications/${insta.id}`, { platform: 'instagram', planned_date: '2026-11-20', post_url: 'instagram.com/p/abc' })).body;
  assert.equal(p.status, 'aktiv', 'noch nicht alle veröffentlicht');
  assert.equal(p.publications.find((x: any) => x.id === insta.id).post_url, 'https://instagram.com/p/abc');
  p = (await t.request('PUT', `/api/publications/${tiktok.id}`, { platform: 'tiktok', planned_date: '2026-11-21', post_url: 'https://tiktok.com/@roma/1' })).body;
  assert.equal(p.status, 'abgeschlossen');
  assert.equal(p.progress, 100);

  const blocked = await t.request('POST', `/api/projects/${p.id}/move`, { to_phase: 4 });
  assert.equal(blocked.status, 409, 'abgeschlossene Projekte nicht verschiebbar');
  p = (await t.request('POST', `/api/projects/${p.id}/reopen`)).body;
  assert.equal(p.status, 'aktiv');
});

test('Paketverbrauch zählt angelegte Projekte des Leistungsmonats', async () => {
  const month = monthBerlin();
  const before = (await t.request('GET', `/api/customers/${customerId}?month=${month}`)).body.package_usage.items[0].used;
  const p = (await t.request('POST', '/api/projects', { customer_id: customerId, title: 'Zählung', deliverable_count: 2, service_month: month })).body;
  const after = (await t.request('GET', `/api/customers/${customerId}?month=${month}`)).body.package_usage.items[0].used;
  assert.equal(after - before, 2);
  await t.request('PUT', `/api/projects/${p.id}`, {
    title: 'Zählung',
    deliverable_type_id: reelTypeId,
    deliverable_count: 2,
    service_month: month,
    priority: 'normal',
    status: 'abgebrochen',
  });
  const cancelled = (await t.request('GET', `/api/customers/${customerId}?month=${month}`)).body.package_usage.items[0].used;
  assert.equal(cancelled, before, 'abgebrochene Projekte zählen nicht');
});

test('Liste, Rechnungsstatus und Löschen', async () => {
  const p = (await t.request('POST', '/api/projects', { customer_id: customerId, title: 'Rechnungstest' })).body;
  const inv = await t.request('PUT', `/api/projects/${p.id}/invoice`, { invoice_status: 'gestellt', invoice_number: 'RE-2026-041', invoice_amount_cents: 89000 });
  assert.equal(inv.body.invoice_status, 'gestellt');
  assert.equal(inv.body.invoice_date, todayBerlin(), 'Rechnungsdatum automatisch');
  const list = await t.request('GET', `/api/projects?customer_id=${customerId}`);
  assert.ok(list.body.some((x: any) => x.id === p.id && x.invoice_status === 'gestellt'));
  const del = await t.request('DELETE', `/api/projects/${p.id}`);
  assert.equal(del.status, 204);
  assert.equal((await t.request('GET', `/api/projects/${p.id}`)).status, 404);
});

test('Aufgaben: anlegen, Kunde aus Projekt übernehmen, erledigen, filtern', async () => {
  const p = (await t.request('POST', '/api/projects', { customer_id: customerId, title: 'Aufgabentest' })).body;
  const created = await t.request('POST', '/api/tasks', { title: 'Musik lizenzieren', project_id: p.id, phase: 2, due_date: '2020-01-01', priority: 'hoch' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.customer_id, customerId);
  assert.equal(created.body.project_title, 'Aufgabentest');
  const overdue = await t.request('GET', '/api/tasks?range=ueberfaellig');
  assert.ok(overdue.body.some((x: any) => x.id === created.body.id));
  const done = await t.request('PATCH', `/api/tasks/${created.body.id}`, { status: 'erledigt' });
  assert.ok(done.body.completed_at);
  const open = await t.request('GET', `/api/tasks?project_id=${p.id}`);
  assert.equal(open.body.length, 0);
  const all = await t.request('GET', `/api/tasks?project_id=${p.id}&status=alle`);
  assert.equal(all.body.length, 1);
  const bad = await t.request('POST', '/api/tasks', { title: '' });
  assert.equal(bad.body.fields.title, 'Titel fehlt');
});

test('Fortschrittsformel', () => {
  assert.equal(computeProgress({ status: 'aktiv', current_phase: 1, items_total: 0, items_done: 0 }), 0);
  assert.equal(computeProgress({ status: 'aktiv', current_phase: 2, items_total: 4, items_done: 3 }), 35);
  assert.equal(computeProgress({ status: 'aktiv', current_phase: 5, items_total: 2, items_done: 2 }), 100);
  assert.equal(computeProgress({ status: 'abgeschlossen', current_phase: 5, items_total: 3, items_done: 0 }), 100);
});
