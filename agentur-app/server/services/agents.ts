// Anbindung der Claude-Agenten (Videoschnitt, Endkontrolle, Highlight-Reel):
// Projektkontext für den Agenten, vorbereitete Aufträge und Rückmeldung der Prüfergebnisse.
import type { Database } from '../db/database.ts';
import type { AppConfig } from '../env.ts';
import type { Services } from '../google/index.ts';
import { events } from '../lib/events.ts';
import { HttpError, notFound } from '../lib/http.ts';
import { nowIso } from '../lib/time.ts';
import { getProject } from './projects.ts';
import { getCustomer } from './customers.ts';
import { getSettings } from './settings.ts';
import { notify } from './notify.ts';
import {
  PHASE_LABELS,
  PLATFORM_LABELS,
  QA_PROFILE_BY_TYPE,
  type AgentKind,
  type QaProfile,
  type QualityCheck,
  type qualityCheckInput,
} from '../../shared/schemas.ts';
import type { z } from 'zod';

interface FolderRef {
  name: string | null;
  url: string;
  id: string;
}

export function listQualityChecks(db: Database, projectId: number): QualityCheck[] {
  return db
    .all<Omit<QualityCheck, 'issues'> & { issues_json: string }>(
      'SELECT * FROM quality_checks WHERE project_id = ? ORDER BY created_at DESC, id DESC',
      [projectId],
    )
    .map(({ issues_json, ...q }) => ({ ...q, issues: JSON.parse(issues_json || '[]') }));
}

/**
 * Fassungen desselben Videos zusammenführen: "reel_01_v3.mp4", "Reel 01 (2).mov", "reel_01_final.mp4"
 * und "reel_01.mp4" gelten als dasselbe Video.
 */
export function videoKey(name: string): string {
  let k = name.trim().toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '');
  for (let i = 0; i < 3; i++) {
    k = k
      .replace(/[\s._-]*\(\d+\)$/, '')
      .replace(/[\s._-]*(v|version|fassung|korrektur)[\s._-]*\d+$/, '')
      .replace(/[\s._-]+(final|fertig|endfassung|freigabe|korrigiert)$/, '');
  }
  return k.replace(/[\s._-]+/g, ' ').trim() || name.trim().toLowerCase();
}

/**
 * Qualitäts-Haken aus den Endkontrollen ableiten: erledigt, wenn für jedes Video die
 * jüngste Endkontrolle "freigegeben" lautet; ein "zurück" nimmt den Haken wieder weg.
 * Es zählen nur Endkontrollen seit dem letzten Eintritt in die Bearbeitung, damit nach einer
 * Korrekturschleife alte Ergebnisse den Haken nicht wieder setzen. Ohne solche Ergebnisse
 * bleibt der Haken, wie er ist (auch ein von Hand gesetzter).
 */
function syncGate(db: Database, projectId: number): 'gesetzt' | 'entfernt' | 'unveraendert' {
  const since = db.get<{ entered_at: string | null }>(
    'SELECT entered_at FROM project_phases WHERE project_id = ? AND phase = 2',
    [projectId],
  )?.entered_at;
  const checks = db.all<{ video_name: string; verdict: string }>(
    `SELECT video_name, verdict FROM quality_checks
     WHERE project_id = :id AND stage = 'endkontrolle' AND verdict <> 'offen' AND (:since IS NULL OR created_at >= :since)
     ORDER BY created_at, id`,
    { id: projectId, since: since ?? null },
  );
  if (!checks.length) return 'unveraendert';
  const latest = new Map<string, string>();
  for (const c of checks) latest.set(videoKey(c.video_name), c.verdict);
  const ok = [...latest.values()].every((v) => v === 'freigegeben');
  const r = db.run(
    `UPDATE checklist_items SET is_done = :done, done_at = CASE WHEN :done = 1 THEN COALESCE(done_at, :now) ELSE NULL END
     WHERE project_id = :id AND auto_key = 'quality_check' AND is_done <> :done`,
    { id: projectId, done: ok ? 1 : 0, now: nowIso() },
  );
  return r.changes ? (ok ? 'gesetzt' : 'entfernt') : 'unveraendert';
}

export function recordQualityCheck(db: Database, projectId: number, data: z.output<typeof qualityCheckInput>): QualityCheck[] {
  const p = db.get<{ title: string }>('SELECT title FROM projects WHERE id = ?', [projectId]);
  if (!p) throw notFound('Projekt');
  db.transaction(() => {
    db.run(
      `INSERT INTO quality_checks (project_id, video_name, stage, verdict, run_no, profile, shots, drone_perspectives,
         summary, issues_json, clip_list, source)
       VALUES (:pid, :video, :stage, :verdict, :run, :profile, :shots, :drones, :summary, :issues, :clips, :source)`,
      {
        pid: projectId,
        video: data.video_name,
        stage: data.stage,
        verdict: data.verdict,
        run: data.run_no,
        profile: data.profile,
        shots: data.shots,
        drones: data.drone_perspectives,
        summary: data.summary,
        issues: JSON.stringify(data.issues),
        clips: data.clip_list,
        source: data.source,
      },
    );
    const final = data.stage === 'endkontrolle' && data.verdict !== 'offen';
    // Vorprüfungen und offene Ergebnisse ändern den Haken nicht
    const gate = final ? syncGate(db, projectId) : 'unveraendert';
    db.run('UPDATE projects SET updated_at = ? WHERE id = ?', [nowIso(), projectId]);
    if (final) {
      const passed = data.verdict === 'freigegeben';
      notify(db, {
        type: 'system',
        title: passed ? `Endkontrolle bestanden: ${data.video_name}` : `Endkontrolle: zurück in die Überarbeitung`,
        body: [
          `${p.title}${passed ? '' : ` – ${data.video_name}`}`,
          data.summary,
          !passed && data.issues.length ? `${data.issues.length} Punkte offen` : null,
          gate === 'gesetzt' ? 'Clip-Qualitätsprüfung abgehakt.' : gate === 'entfernt' ? 'Haken bei der Clip-Qualitätsprüfung entfernt.' : null,
        ]
          .filter(Boolean)
          .join('. '),
        link: `/projekte/${projectId}`,
      });
    }
  });
  events.changed('projects', projectId);
  return listQualityChecks(db, projectId);
}

export function deleteQualityCheck(db: Database, id: number): number {
  const q = db.get<{ project_id: number; stage: string; verdict: string }>('SELECT project_id, stage, verdict FROM quality_checks WHERE id = ?', [id]);
  if (!q) throw notFound('Prüfergebnis');
  db.run('DELETE FROM quality_checks WHERE id = ?', [id]);
  if (q.stage === 'endkontrolle' && q.verdict !== 'offen') syncGate(db, q.project_id);
  events.changed('projects', q.project_id);
  return q.project_id;
}

export function effectiveProfile(customer: { qa_profile: QaProfile | null; customer_type: keyof typeof QA_PROFILE_BY_TYPE }): {
  profil: QaProfile;
  herkunft: 'kunde' | 'kundentyp';
} {
  return customer.qa_profile
    ? { profil: customer.qa_profile, herkunft: 'kunde' }
    : { profil: QA_PROFILE_BY_TYPE[customer.customer_type], herkunft: 'kundentyp' };
}

/** Alles, was ein Agent über ein Projekt wissen muss, als JSON */
export function agentContext(db: Database, config: AppConfig, services: Services, projectId: number) {
  const p = getProject(db, projectId);
  const c = getCustomer(db, p.customer_id);
  const settings = getSettings(db);
  const base = `http://localhost:${config.port}`;
  const drive = services.drive.projectDrive(projectId);
  const ref = (role: string): FolderRef | null => {
    const f = drive.folders.find((x) => x.role === role);
    return f ? { name: f.name, url: f.web_url, id: f.google_folder_id } : null;
  };
  const year = db.get<{ name: string | null }>(
    "SELECT name FROM drive_folders WHERE customer_id = ? AND project_id IS NULL AND role = 'jahr' AND year = ?",
    [c.id, Number(p.service_month.slice(0, 4))],
  );
  const projectFolder = ref('projekt');
  const pathHint =
    drive.customer_folder?.origin === 'angelegt' && projectFolder?.name
      ? [settings.drive_root_folder, drive.customer_folder.name, year?.name, projectFolder.name].filter(Boolean).join('/')
      : null;
  const items = (phase: number, kind: string) => p.checklist.filter((i) => i.phase === phase && i.kind === kind).map((i) => i.label);
  const lastCorrection = p.approval_rounds.find((r) => r.result === 'korrektur');
  const openRound = p.approval_rounds.find((r) => !r.responded_at);
  const qa = effectiveProfile(c);

  return {
    app: {
      basis_url: base,
      projekt_url: `${base}/projekte/${p.id}`,
      ergebnis_melden: { methode: 'POST', url: `${base}/api/projects/${p.id}/quality-checks` },
    },
    projekt: {
      id: p.id,
      titel: p.title,
      phase: p.current_phase,
      phase_name: PHASE_LABELS[p.current_phase],
      status: p.status,
      leistung: p.deliverable_type_name,
      anzahl: p.deliverable_count,
      leistungsmonat: p.service_month,
      beschreibung: p.description,
      notizen: p.notes,
      phasen_notizen: Object.fromEntries(p.phases.filter((x) => x.notes).map((x) => [PHASE_LABELS[x.phase], x.notes])),
    },
    kunde: {
      id: c.id,
      name: c.company_name,
      kundentyp: c.customer_type,
      branche: c.industry,
      ansprechpartner: c.contacts.map((x) => ({ name: x.name, rolle: x.role, email: x.email, telefon: x.phone })),
    },
    qualitaet: {
      profil: qa.profil,
      profil_herkunft: qa.herkunft,
      bewegung_pflicht: !!c.qa_motion_required,
      hinweise: c.qa_notes,
    },
    drehtag: {
      datum: p.shoot.shoot_date,
      von: p.shoot.start_time,
      bis: p.shoot.end_time,
      ort: p.shoot.location,
      hinweise_vor_ort: p.shoot.location_notes,
      shotlist: items(1, 'shot'),
      shotlist_notizen: p.shoot.shotlist_notes,
      equipment: items(1, 'equipment'),
    },
    drive: {
      verbunden: services.google.connected,
      kundenordner: drive.customer_folder ? { name: drive.customer_folder.name, url: drive.customer_folder.web_url, id: drive.customer_folder.google_folder_id } : null,
      projektordner: projectFolder,
      rohmaterial: ref('rohmaterial'),
      schnitt: ref('schnitt'),
      fertige_videos: ref('final'),
      freigabe: ref('freigabe'),
      pfad_in_meine_ablage: pathHint,
      hinweis:
        'Auf dem Mac liegen die Drive-Ordner über „Google Drive für den Desktop“ unter ~/Library/CloudStorage/GoogleDrive-<Konto>/Meine Ablage (bzw. My Drive).',
    },
    freigabe: {
      runden: p.approval_rounds.length,
      korrekturschleifen: p.correction_count,
      offene_runde_seit: openRound?.requested_at ?? null,
      letzte_rueckmeldung: lastCorrection?.feedback ?? null,
      alle_rueckmeldungen: p.approval_rounds
        .filter((r) => r.feedback)
        .map((r) => ({ runde: r.round_no, ergebnis: r.result, rueckmeldung: r.feedback, datum: r.responded_at })),
    },
    veroeffentlichungen: p.publications.map((x) => ({
      plattform: PLATFORM_LABELS[x.platform],
      datum: x.planned_date,
      uhrzeit: x.planned_time,
      status: x.status,
    })),
    fruehere_pruefungen: listQualityChecks(db, p.id)
      .slice(0, 20)
      .map((q) => ({ video: q.video_name, stufe: q.stage, urteil: q.verdict, durchlauf: q.run_no, zusammenfassung: q.summary, punkte: q.issues, datum: q.created_at })),
    regeln: [
      'Arbeitsdateien (Vorschauen, Kontaktbögen, Renderings) nie im Ordner der App ablegen, sondern im Arbeitsbereich ~/Agentur/Arbeitsbereich/<Kunde>/<Projekt>.',
      'Fertige Videos in den Drive-Ordner „fertige_videos“ legen; die App erkennt sie dort automatisch.',
      'Nach jeder Endkontrolle das Ergebnis an „ergebnis_melden“ senden, auch bei ZURÜCK.',
    ],
  };
}

/** Vorbereiteter Auftrag zum Einfügen in Claude */
export function agentPrompt(db: Database, config: AppConfig, services: Services, projectId: number, kind: AgentKind, opts: { dauer?: number } = {}): string {
  const ctx = agentContext(db, config, services, projectId);
  const head = `Projekt ${ctx.projekt.id} der Agentur-Verwaltung: „${ctx.projekt.titel}“ für ${ctx.kunde.name}.`;
  const contextLine = `Projektkontext: ${ctx.app.basis_url}/api/projects/${ctx.projekt.id}/agent-context (die App muss laufen).`;
  const qa = `Prüfprofil ${ctx.qualitaet.profil}${ctx.qualitaet.bewegung_pflicht ? ' mit --bewegung-pflicht' : ''}${ctx.qualitaet.hinweise ? `. Hinweise zum Kunden: ${ctx.qualitaet.hinweise}` : ''}.`;
  const target = ctx.projekt.leistung ? `Ziel: ${ctx.projekt.anzahl} × ${ctx.projekt.leistung}${ctx.veroeffentlichungen.length ? ` für ${[...new Set(ctx.veroeffentlichungen.map((v) => v.plattform))].join(', ')}` : ''}.` : '';
  const feedback = ctx.freigabe.letzte_rueckmeldung
    ? `\nKundenfeedback aus der letzten Korrekturschleife, jeden Punkt einzeln umsetzen:\n${ctx.freigabe.letzte_rueckmeldung}`
    : '';
  const report = `Melde das Ergebnis jeder Endkontrolle an die App (${ctx.app.ergebnis_melden.url}).`;

  if (kind === 'videoschnitt') {
    return [
      `Nutze den Agenten „videoschnitt“. ${head}`,
      contextLine,
      `Aufgabe: Rohmaterial sichten und prüfen, schneiden und die Endkontrolle durchführen, vollständig nach dem Skill clip-qualitaetspruefung. ${qa} ${target}`.trim(),
      ctx.drive.rohmaterial ? `Rohmaterial: Drive-Ordner „${ctx.drive.rohmaterial.name}“${ctx.drive.pfad_in_meine_ablage ? ` (Meine Ablage/${ctx.drive.pfad_in_meine_ablage})` : ''}.` : 'Für das Projekt ist noch kein Drive-Ordner verknüpft; frag mich nach dem Speicherort des Rohmaterials.',
      `Fertige, freigegebene Videos in „${ctx.drive.fertige_videos?.name ?? 'Fertige Videos'}“ ablegen. ${report}${feedback}`,
    ].join('\n');
  }
  if (kind === 'endkontrolle') {
    return [
      `Nutze den Agenten „videoschnitt“ nur für die Endkontrolle. ${head}`,
      contextLine,
      `Aufgabe: Jedes Video im Ordner „${ctx.drive.fertige_videos?.name ?? 'Fertige Videos'}“ durch die Endkontrolle des Skills clip-qualitaetspruefung schicken (Schritt 9 mit Sichtprüfung und Hintergrund-Jitter). ${qa}`,
      `Nichts neu schneiden, nur prüfen und berichten. ${report}`,
    ].join('\n');
  }
  if (kind === 'highlight') {
    const dauer = opts.dauer && opts.dauer > 0 ? Math.round(opts.dauer) : 30;
    return [
      `Nutze den Agenten „videoschnitt“ für ein Highlight-Reel. ${head}`,
      contextLine,
      `Aufgabe: Ein Highlight-Reel mit etwa ${dauer} Sekunden. Zuerst das Rohmaterial nach clip-qualitaetspruefung prüfen und die freigegebenen Teile zu geprueft.mp4 verbinden (Schritt 8 mit --zusammen), dann local-highlight-reel nur auf geprueft.mp4 anwenden, danach die Endkontrolle. ${qa}`,
      `Ergebnis in „${ctx.drive.fertige_videos?.name ?? 'Fertige Videos'}“ ablegen. ${report}`,
    ].join('\n');
  }
  if (kind === 'pdf') {
    return [`Nutze den Agenten „pdf-erstellung“. ${head}`, contextLine, 'Aufgabe: '].join('\n');
  }
  throw new HttpError(400, 'Unbekannter Agent');
}
