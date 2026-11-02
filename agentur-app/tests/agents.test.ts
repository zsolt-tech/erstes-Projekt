import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { startTestApp, type TestApp } from './helpers.ts';
import { monthBerlin, todayBerlin } from '../server/lib/time.ts';

let t: TestApp;
let customer: any;
let project: any;
const gateOf = (p: any) => p.checklist.find((i: any) => i.is_gate && i.phase === 2);

/** Text eines PDFs, sofern pdftotext installiert ist (sonst null) */
function pdfText(buf: Buffer): string | null {
  const file = path.join(t.dir, `t${Date.now()}.pdf`);
  fs.writeFileSync(file, buf);
  try {
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  } catch {
    return null;
  }
}

async function getPdf(url: string) {
  const res = await fetch(t.url + url);
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf };
}

before(async () => {
  t = await startTestApp();
  customer = (await t.request('POST', '/api/customers', {
    company_name: 'Praxis Dr. Neumann',
    customer_type: 'arztpraxis',
    contacts: [{ name: 'Dr. Lena Neumann', role: 'Inhaberin', phone: '0228 12345', email: 'praxis@neumann.de' }],
    package_items: [{ deliverable_type_id: 1, quantity_per_month: 2, valid_from: '2026-01-01' }],
  })).body;
  project = (await t.request('POST', '/api/projects', {
    customer_id: customer.id,
    title: 'Praxisvorstellung',
    shoot_date: todayBerlin(),
    start_time: '08:00',
    end_time: '10:30',
    location: 'Hauptstraße 5, Bonn',
    service_month: monthBerlin(),
  })).body;
});
after(async () => {
  await t.close();
});

test('Kunde: Prüfprofil, Bewegungspflicht und Schnitt-Hinweise speichern', async () => {
  const res = await t.request('PUT', `/api/customers/${customer.id}`, {
    company_name: 'Praxis Dr. Neumann',
    customer_type: 'arztpraxis',
    contacts: customer.contacts,
    package_items: customer.package_items.map((p: any) => ({ ...p, valid_until: null })),
    qa_profile: null,
    qa_motion_required: true,
    qa_notes: 'Keine Patienten, keine Bildschirme.',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.qa_motion_required, 1);
  assert.equal(res.body.qa_notes, 'Keine Patienten, keine Bildschirme.');
  const bad = await t.request('PUT', `/api/customers/${customer.id}`, { company_name: 'X', qa_profile: 'unbekannt' });
  assert.equal(bad.status, 400);
});

test('Agentenkontext: Profil aus dem Kundentyp, Drehtag, Feedback der Korrekturschleife', async () => {
  // Korrekturschleife erzeugen
  await t.request('PATCH', `/api/checklist/${gateOf(project).id}`, { is_done: true });
  await t.request('POST', `/api/projects/${project.id}/move`, { to_phase: 4 });
  await t.request('POST', `/api/projects/${project.id}/approval`, { result: 'korrektur', feedback: 'Logo am Ende größer. Musik leiser.' });

  const ctx = (await t.request('GET', `/api/projects/${project.id}/agent-context`)).body;
  assert.equal(ctx.qualitaet.profil, 'zahnarzt', 'Arztpraxis nutzt das strenge Profil');
  assert.equal(ctx.qualitaet.profil_herkunft, 'kundentyp');
  assert.equal(ctx.qualitaet.bewegung_pflicht, true);
  assert.equal(ctx.kunde.ansprechpartner[0].name, 'Dr. Lena Neumann');
  assert.equal(ctx.drehtag.ort, 'Hauptstraße 5, Bonn');
  assert.ok(ctx.drehtag.shotlist.includes('Teamvorstellung'));
  assert.equal(ctx.freigabe.letzte_rueckmeldung, 'Logo am Ende größer. Musik leiser.');
  assert.equal(ctx.drive.verbunden, false);
  assert.match(ctx.app.ergebnis_melden.url, new RegExp(`/api/projects/${project.id}/quality-checks$`));

  const prompt = (await t.request('GET', `/api/projects/${project.id}/agent-prompt?kind=videoschnitt`)).body.prompt;
  assert.match(prompt, /Agenten „videoschnitt“/);
  assert.match(prompt, /clip-qualitaetspruefung/);
  assert.match(prompt, /Prüfprofil zahnarzt mit --bewegung-pflicht/);
  assert.match(prompt, /Logo am Ende größer/);
  const highlight = (await t.request('GET', `/api/projects/${project.id}/agent-prompt?kind=highlight&dauer=45`)).body.prompt;
  assert.match(highlight, /etwa 45 Sekunden/);
  assert.match(highlight, /local-highlight-reel nur auf geprueft\.mp4/);
  assert.equal((await t.request('GET', `/api/projects/${project.id}/agent-prompt?kind=zaubern`)).status, 400);
});

test('Endkontrolle: Ergebnis setzt und entfernt den Qualitäts-Haken', async () => {
  let p = (await t.request('GET', `/api/projects/${project.id}`)).body;
  assert.equal(p.current_phase, 2);
  assert.equal(gateOf(p).is_done, 0, 'nach der Korrektur zurückgesetzt');

  const ok1 = await t.request('POST', `/api/projects/${project.id}/quality-checks`, {
    video_name: 'praxis_reel_01_v2.mp4',
    stage: 'endkontrolle',
    verdict: 'freigegeben',
    run_no: 2,
    profile: 'zahnarzt',
    shots: 9,
    summary: 'Endkontrolle bestanden: 9 Shots, Voiceover vollständig',
  });
  assert.equal(ok1.status, 201, JSON.stringify(ok1.body));
  p = (await t.request('GET', `/api/projects/${project.id}`)).body;
  assert.equal(gateOf(p).is_done, 1, 'Haken gesetzt');

  await t.request('POST', `/api/projects/${project.id}/quality-checks`, {
    video_name: 'praxis_reel_02.mp4',
    stage: 'endkontrolle',
    verdict: 'zurueck',
    issues: [{ t: '0:19', text: 'Bildschirm mit Patientendaten lesbar' }],
  });
  p = (await t.request('GET', `/api/projects/${project.id}`)).body;
  assert.equal(gateOf(p).is_done, 0, 'ein Video zurück: Haken weg');
  const blocked = await t.request('POST', `/api/projects/${project.id}/move`, { to_phase: 3 });
  assert.equal(blocked.status, 409);

  const ok2 = await t.request('POST', `/api/projects/${project.id}/quality-checks`, {
    video_name: 'praxis_reel_02.mp4',
    stage: 'endkontrolle',
    verdict: 'freigegeben',
    run_no: 2,
  });
  assert.equal(ok2.body.length, 3);
  assert.deepEqual(ok2.body.find((q: any) => q.verdict === 'zurueck').issues, [{ t: '0:19', text: 'Bildschirm mit Patientendaten lesbar' }]);
  p = (await t.request('GET', `/api/projects/${project.id}`)).body;
  assert.equal(gateOf(p).is_done, 1, 'alle Videos freigegeben');
  assert.equal((await t.request('POST', `/api/projects/${project.id}/move`, { to_phase: 3 })).status, 200);

  const notes = (await t.request('GET', '/api/notifications')).body.items.map((n: any) => n.title);
  assert.ok(notes.includes('Endkontrolle bestanden: praxis_reel_02.mp4'));
  assert.ok(notes.includes('Endkontrolle: zurück in die Überarbeitung'));

  // Fehlerhafte Meldung entfernen: Haken wird neu berechnet
  const del = await t.request('DELETE', `/api/quality-checks/${ok2.body[0].id}`);
  assert.equal(del.body.length, 2);
  p = (await t.request('GET', `/api/projects/${project.id}`)).body;
  assert.equal(gateOf(p).is_done, 0);

  const invalid = await t.request('POST', `/api/projects/${project.id}/quality-checks`, { video_name: '', stage: 'x', verdict: 'y' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.fields.video_name, 'Name des Videos fehlt');
});

test('Fassungen eines Videos gelten als dasselbe Video', async () => {
  const { videoKey } = await import('../server/services/agents.ts');
  assert.equal(videoKey('Reel_01_v3.mp4'), 'reel 01');
  assert.equal(videoKey('reel-01 (2).mov'), 'reel 01');
  assert.equal(videoKey('Reel 01 Fassung 2.mp4'), 'reel 01');
  assert.equal(videoKey('reel_01.mp4'), 'reel 01');
  assert.notEqual(videoKey('reel_02.mp4'), 'reel 01');

  const p = (await t.request('POST', '/api/projects', { customer_id: customer.id, title: 'Fassungstest' })).body;
  await t.request('POST', `/api/projects/${p.id}/quality-checks`, { video_name: 'teaser_v2.mp4', stage: 'endkontrolle', verdict: 'zurueck' });
  await t.request('POST', `/api/projects/${p.id}/quality-checks`, { video_name: 'teaser_v3.mp4', stage: 'endkontrolle', verdict: 'freigegeben' });
  const after = (await t.request('GET', `/api/projects/${p.id}`)).body;
  assert.equal(gateOf(after).is_done, 1, 'v3 ersetzt v2');
});

test('PDF: Drehplan, Freigabe-Protokoll, Monatsbericht und Briefing', async () => {
  await t.request('POST', `/api/projects/${project.id}/publications`, { platform: 'instagram', planned_date: todayBerlin(), post_url: 'https://instagram.com/p/praxis1' });

  const drehplan = await getPdf(`/api/projects/${project.id}/drehplan.pdf`);
  assert.equal(drehplan.res.status, 200);
  assert.equal(drehplan.res.headers.get('content-type'), 'application/pdf');
  assert.match(drehplan.res.headers.get('content-disposition')!, /inline; filename="Drehplan_Praxis-Dr-Neumann_Praxisvorstellung_\d{4}-\d{2}-\d{2}\.pdf"/);
  assert.equal(drehplan.buf.subarray(0, 5).toString(), '%PDF-');

  const freigabe = await getPdf(`/api/projects/${project.id}/freigabe.pdf?download=1`);
  assert.match(freigabe.res.headers.get('content-disposition')!, /^attachment;/);
  const bericht = await getPdf(`/api/customers/${customer.id}/report.pdf?month=${monthBerlin()}`);
  assert.equal(bericht.res.status, 200);
  const briefing = await getPdf('/api/briefing/pdf');
  assert.equal(briefing.res.status, 200);
  assert.equal((await fetch(`${t.url}/api/customers/${customer.id}/report.pdf?month=13-2026`)).status, 400);

  const text = pdfText(drehplan.buf);
  if (text === null) return; // pdftotext nicht installiert: Inhaltsprüfung entfällt
  assert.match(text, /Drehplan/);
  assert.match(text, /Praxis Dr\. Neumann – Praxisvorstellung/);
  assert.match(text, /Hauptstraße 5, Bonn/);
  assert.match(text, /08:00 bis 10:30 Uhr/);
  assert.match(text, /Teamvorstellung/);
  assert.match(text, /Arzt- und Zahnarztpraxis \(streng\), durchgehende Kamerabewegung Pflicht/);
  assert.match(text, /Seite 1 von \d/);

  const ftext = pdfText(freigabe.buf)!;
  assert.match(ftext, /Freigabe-Protokoll/);
  assert.match(ftext, /Logo am Ende größer/);
  assert.match(ftext, /Bildschirm mit Patientendaten lesbar|überarbeitet/);

  const btext = pdfText(bericht.buf)!;
  assert.match(btext, /Monatsbericht/);
  assert.match(btext, /Veröffentlichungen/);
  assert.match(btext, /instagram\.com\/p\/praxis1/);
  assert.doesNotMatch(btext, /Rechnung/, 'keine internen Angaben im Kundenbericht');

  const brtext = pdfText(briefing.buf)!;
  assert.match(brtext, /Briefing/);
  assert.match(brtext, /Termine heute/);
});
