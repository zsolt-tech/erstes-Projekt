import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, type TestApp } from './helpers.ts';
import { monthBerlin, todayBerlin } from '../server/lib/time.ts';

let t: TestApp;
before(async () => {
  t = await startTestApp();
});
after(async () => {
  await t.close();
});

test('Kunde mit Ansprechpartnern, Kanälen und Paket anlegen', async () => {
  const types = await t.request('GET', '/api/deliverable-types');
  const reel = types.body.find((d: any) => d.name === 'Reel');
  const post = types.body.find((d: any) => d.name === 'Post');
  assert.ok(reel && post, 'Standard-Leistungsarten vorhanden');

  const res = await t.request('POST', '/api/customers', {
    company_name: 'Pizzeria Roma',
    industry: 'Gastronomie',
    customer_type: 'restaurant',
    status: 'aktiv',
    city: 'Köln',
    website: 'pizzeria-roma.de',
    contacts: [
      { name: 'Marco Rossi', role: 'Inhaber', phone: '0221 123456', email: 'marco@roma.de' },
      { name: 'Anna Rossi', email: '', is_primary: true },
    ],
    social_channels: [{ platform: 'instagram', handle: '@pizzeriaroma' }],
    package_items: [
      { deliverable_type_id: reel.id, quantity_per_month: 4, monthly_price_cents: 89000, valid_from: '2026-01-01' },
      { deliverable_type_id: post.id, quantity_per_month: 8, valid_from: '2026-01-01' },
    ],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const c = res.body;
  assert.equal(c.website, 'https://pizzeria-roma.de');
  assert.equal(c.country, 'Deutschland');
  assert.equal(c.pipeline_stage, null);
  assert.equal(c.contacts.length, 2);
  assert.equal(c.contacts[0].name, 'Anna Rossi', 'markierter Hauptkontakt steht vorne');
  assert.equal(c.contacts[0].email, null, 'leere E-Mail wird zu null');
  assert.equal(c.contacts.filter((x: any) => x.is_primary).length, 1);
  assert.equal(c.package_usage.items.length, 2);
  const reelUsage = c.package_usage.items.find((i: any) => i.deliverable_type_name === 'Reel');
  assert.deepEqual([reelUsage.quantity, reelUsage.used], [4, 0]);

  // Paketverbrauch zählt Projekte des Leistungsmonats
  t.db.run(
    `INSERT INTO projects (customer_id, title, deliverable_type_id, deliverable_count, service_month, status)
     VALUES (?, 'Reels', ?, 3, ?, 'aktiv'), (?, 'Alt', ?, 2, '2025-01', 'aktiv'), (?, 'Storno', ?, 1, ?, 'abgebrochen')`,
    [c.id, reel.id, monthBerlin(), c.id, reel.id, c.id, reel.id, monthBerlin()],
  );
  const detail = await t.request('GET', `/api/customers/${c.id}`);
  const usage = detail.body.package_usage.items.find((i: any) => i.deliverable_type_name === 'Reel');
  assert.equal(usage.used, 3);

  const list = await t.request('GET', '/api/customers');
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].primary_contact_name, 'Anna Rossi');
  assert.equal(list.body[0].package_summary, '4 × Reel, 8 × Post');
});

test('Bearbeiten gleicht Ansprechpartner ab (ändern, hinzufügen, entfernen)', async () => {
  const created = await t.request('POST', '/api/customers', {
    company_name: 'Elektro Schmidt',
    customer_type: 'handwerk',
    contacts: [{ name: 'Peter' }, { name: 'Paul' }],
  });
  const [peter] = created.body.contacts;
  const res = await t.request('PUT', `/api/customers/${created.body.id}`, {
    company_name: 'Elektro Schmidt GmbH',
    customer_type: 'handwerk',
    contacts: [{ id: peter.id, name: 'Peter Schmidt', phone: '0170 1' }, { name: 'Neu' }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.company_name, 'Elektro Schmidt GmbH');
  assert.deepEqual(
    res.body.contacts.map((x: any) => x.name),
    ['Peter Schmidt', 'Neu'],
  );
  assert.equal(res.body.contacts[0].id, peter.id, 'ID bleibt erhalten');
});

test('Interessent bekommt Pipeline-Stufe, Umwandlung setzt gewonnen', async () => {
  const lead = await t.request('POST', '/api/customers', { company_name: 'Fahrschule Blitz', status: 'interessent' });
  assert.equal(lead.body.pipeline_stage, 'erstkontakt');
  assert.equal(lead.body.converted_at, null);
  const converted = await t.request('PUT', `/api/customers/${lead.body.id}`, {
    company_name: 'Fahrschule Blitz',
    status: 'aktiv',
  });
  assert.equal(converted.body.pipeline_stage, 'gewonnen');
  assert.ok(converted.body.converted_at);
});

test('Archivieren blendet Kunden aus der Liste aus', async () => {
  const c = await t.request('POST', '/api/customers', { company_name: 'Praxis Dr. Neumann', customer_type: 'arztpraxis' });
  await t.request('POST', `/api/customers/${c.body.id}/archive`);
  const active = await t.request('GET', '/api/customers');
  assert.ok(!active.body.some((x: any) => x.id === c.body.id));
  const archived = await t.request('GET', '/api/customers?archived=1');
  assert.ok(archived.body.some((x: any) => x.id === c.body.id));
  await t.request('POST', `/api/customers/${c.body.id}/unarchive`);
  const again = await t.request('GET', '/api/customers');
  assert.ok(again.body.some((x: any) => x.id === c.body.id));
});

test('Suche und Statusfilter', async () => {
  const byContact = await t.request('GET', '/api/customers?q=marco');
  assert.deepEqual(
    byContact.body.map((x: any) => x.company_name),
    ['Pizzeria Roma'],
  );
  const leads = await t.request('GET', '/api/customers?status=aktiv');
  assert.ok(leads.body.every((x: any) => x.status === 'aktiv'));
});

test('Validierung liefert deutsche Fehlermeldungen', async () => {
  const res = await t.request('POST', '/api/customers', {
    company_name: '  ',
    contacts: [{ name: 'X', email: 'keine-mail' }],
    package_items: [{ deliverable_type_id: 1, quantity_per_month: 0, valid_from: todayBerlin() }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.fields.company_name, 'Firmenname fehlt');
  assert.equal(res.body.fields['contacts.0.email'], 'Ungültige E-Mail-Adresse');
  assert.equal(res.body.fields['package_items.0.quantity_per_month'], 'Mindestens 1 pro Monat');
  const missing = await t.request('GET', '/api/customers/9999');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'Kunde nicht gefunden');
});

test('Einstellungen lesen und ändern', async () => {
  const s = await t.request('GET', '/api/settings');
  assert.equal(s.body.approval_reminder_days, 3);
  const u = await t.request('PUT', '/api/settings', { agency_name: 'Agentur Muster', approval_reminder_days: 4 });
  assert.equal(u.body.agency_name, 'Agentur Muster');
  assert.equal(u.body.approval_reminder_days, 4);
  const bad = await t.request('PUT', '/api/settings', { approval_reminder_days: 0 });
  assert.equal(bad.status, 400);
});

test('Nur Aufrufe über localhost werden angenommen', async () => {
  const http = await import('node:http');
  const status = await new Promise<number>((resolve) => {
    const req = http.request(`${t.url}/api/health`, { headers: { Host: 'angreifer.example:3000' } }, (res) => resolve(res.statusCode ?? 0));
    req.end();
  });
  assert.equal(status, 403);
  assert.equal((await t.request('GET', '/api/health')).status, 200);
});
