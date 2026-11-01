// Projekte und Workflow: Phasen, Checklisten mit Sperrpunkten, Drehtag, Freigaberunden, Veröffentlichungen.
import type { Database } from '../db/database.ts';
import { HttpError, notFound } from '../lib/http.ts';
import { addDays, berlinDateOf, daysBetween, monthBerlin, nowIso, todayBerlin } from '../lib/time.ts';
import { getSettings } from './settings.ts';
import type {
  ApprovalRound,
  ChecklistItem,
  ChecklistKind,
  Phase,
  PhaseTransition,
  ProjectDetail,
  ProjectListItem,
  ProjectPhase,
  ProjectTemplate,
  Publication,
  Shoot,
} from '../../shared/schemas.ts';
import { PHASE_LABELS } from '../../shared/schemas.ts';
import type { z } from 'zod';
import type {
  approvalDecisionInput,
  checklistCreateInput,
  checklistUpdateInput,
  invoiceInput,
  phaseUpdateInput,
  projectCreateInput,
  projectUpdateInput,
  publicationInput,
  shootInput,
} from '../../shared/schemas.ts';

type Out<T extends z.ZodTypeAny> = z.output<T>;

/** Systempunkte, die jedes Projekt erhält, unabhängig von der Vorlage */
const SYSTEM_ITEMS: { phase: Phase; label: string; is_gate: number; auto_key: string }[] = [
  { phase: 2, label: 'Clip-Qualitätsprüfung abgeschlossen', is_gate: 1, auto_key: 'quality_check' },
  { phase: 3, label: 'Dateien im Ordner „Fertige Videos“', is_gate: 0, auto_key: 'final_files_present' },
];

// ---------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------

const LIST_SELECT = `
  SELECT p.id, p.title, p.customer_id, c.company_name AS customer_name, p.current_phase, p.status, p.priority,
         p.service_month, p.deliverable_count, dt.name AS deliverable_type_name, p.invoice_status,
         ph.due_date AS phase_due_date, ph.entered_at AS phase_entered_at,
         tm.name AS assignee_name, tm.color AS assignee_color,
         s.shoot_date, s.start_time,
         (SELECT COUNT(*) FROM checklist_items ci WHERE ci.project_id = p.id AND ci.phase = p.current_phase) AS items_total,
         (SELECT COUNT(*) FROM checklist_items ci WHERE ci.project_id = p.id AND ci.phase = p.current_phase AND ci.is_done = 1) AS items_done,
         (SELECT COUNT(*) FROM checklist_items ci WHERE ci.project_id = p.id AND ci.phase = p.current_phase AND ci.is_gate = 1 AND ci.is_done = 0) AS open_gates,
         (SELECT ar.requested_at FROM approval_rounds ar WHERE ar.project_id = p.id AND ar.responded_at IS NULL
            ORDER BY ar.round_no DESC LIMIT 1) AS approval_requested_at,
         (SELECT COUNT(*) FROM approval_rounds ar WHERE ar.project_id = p.id AND ar.result = 'korrektur') AS correction_count,
         (SELECT MIN(pu.planned_date) FROM publications pu WHERE pu.project_id = p.id AND pu.status = 'geplant') AS next_publication_date,
         p.completed_at, p.updated_at
  FROM projects p
  JOIN customers c ON c.id = p.customer_id
  LEFT JOIN project_phases ph ON ph.project_id = p.id AND ph.phase = p.current_phase
  LEFT JOIN team_members tm ON tm.id = ph.assignee_id
  LEFT JOIN shoots s ON s.project_id = p.id
  LEFT JOIN deliverable_types dt ON dt.id = p.deliverable_type_id`;

type RawListRow = Omit<ProjectListItem, 'progress' | 'overdue' | 'days_in_phase' | 'approval_waiting_days'>;

/** Fortschritt: jede Phase 20 %, die aktuelle anteilig nach erledigten Checklistenpunkten */
export function computeProgress(row: Pick<RawListRow, 'status' | 'current_phase' | 'items_total' | 'items_done'>): number {
  if (row.status === 'abgeschlossen') return 100;
  const share = row.items_total > 0 ? row.items_done / row.items_total : 0;
  return Math.round((row.current_phase - 1) * 20 + 20 * share);
}

function enrich(row: RawListRow, today = todayBerlin()): ProjectListItem {
  const open = row.status === 'aktiv' || row.status === 'pausiert';
  return {
    ...row,
    progress: computeProgress(row),
    overdue: open && !!row.phase_due_date && row.phase_due_date < today,
    days_in_phase: open && row.phase_entered_at ? daysBetween(berlinDateOf(row.phase_entered_at), today) : null,
    approval_waiting_days:
      open && row.current_phase === 4 && row.approval_requested_at
        ? daysBetween(berlinDateOf(row.approval_requested_at), today)
        : null,
  };
}

export interface ProjectFilter {
  customer_id?: number;
  scope?: 'offen' | 'abgeschlossen' | 'abgebrochen' | 'alle';
  q?: string;
}

export function listProjects(db: Database, filter: ProjectFilter = {}): ProjectListItem[] {
  const where: string[] = ['c.archived_at IS NULL OR :cid IS NOT NULL'];
  const params: Record<string, unknown> = { cid: filter.customer_id ?? null };
  if (filter.customer_id) where.push('p.customer_id = :cid');
  const scope = filter.scope ?? 'offen';
  if (scope === 'offen') where.push("p.status IN ('aktiv','pausiert')");
  else if (scope !== 'alle') {
    where.push('p.status = :status');
    params.status = scope;
  }
  if (filter.q?.trim()) {
    where.push('(p.title LIKE :q OR c.company_name LIKE :q OR p.notes LIKE :q OR p.description LIKE :q)');
    params.q = `%${filter.q.trim()}%`;
  }
  const rows = db.all<RawListRow>(
    `${LIST_SELECT} WHERE ${where.map((w) => `(${w})`).join(' AND ')}
     ORDER BY CASE p.status WHEN 'aktiv' THEN 0 WHEN 'pausiert' THEN 1 ELSE 2 END,
              COALESCE(ph.due_date, '9999-12-31'), p.completed_at DESC, p.id DESC`,
    params,
  );
  const today = todayBerlin();
  return rows.map((r) => enrich(r, today));
}

export function getProject(db: Database, id: number): ProjectDetail {
  const row = db.get<RawListRow>(`${LIST_SELECT} WHERE p.id = ?`, [id]);
  if (!row) throw notFound('Projekt');
  const extra = db.get<{
    description: string | null;
    template_id: number | null;
    template_name: string | null;
    deliverable_type_id: number | null;
    invoice_number: string | null;
    invoice_amount_cents: number | null;
    invoice_date: string | null;
    paid_date: string | null;
    approval_reminder_days: number | null;
    customer_reminder_days: number | null;
    notes: string | null;
    created_at: string;
  }>(
    `SELECT p.description, p.template_id, t.name AS template_name, p.deliverable_type_id, p.invoice_number,
            p.invoice_amount_cents, p.invoice_date, p.paid_date, p.approval_reminder_days,
            c.approval_reminder_days AS customer_reminder_days, p.notes, p.created_at
     FROM projects p JOIN customers c ON c.id = p.customer_id
     LEFT JOIN project_templates t ON t.id = p.template_id WHERE p.id = ?`,
    [id],
  )!;
  const { customer_reminder_days, ...rest } = extra;
  const shoot = db.get<Shoot>(
    'SELECT shoot_date, start_time, end_time, location, location_notes, shotlist_notes FROM shoots WHERE project_id = ?',
    [id],
  ) ?? { shoot_date: null, start_time: null, end_time: null, location: null, location_notes: null, shotlist_notes: null };
  return {
    ...enrich(row),
    ...rest,
    effective_reminder_days:
      extra.approval_reminder_days ?? customer_reminder_days ?? getSettings(db).approval_reminder_days,
    phases: db.all<ProjectPhase>(
      'SELECT id, phase, due_date, assignee_id, notes, entered_at, completed_at FROM project_phases WHERE project_id = ? ORDER BY phase',
      [id],
    ),
    checklist: db.all<ChecklistItem>(
      'SELECT * FROM checklist_items WHERE project_id = ? ORDER BY phase, is_gate, sort_order, id',
      [id],
    ),
    shoot,
    approval_rounds: db.all<ApprovalRound>(
      `SELECT id, round_no, requested_at, responded_at, result, feedback, last_reminder_at, reminder_count
       FROM approval_rounds WHERE project_id = ? ORDER BY round_no DESC`,
      [id],
    ),
    publications: db.all<Publication>(
      `SELECT * FROM publications WHERE project_id = ?
       ORDER BY COALESCE(planned_date, '9999-12-31'), COALESCE(planned_time, '99:99'), id`,
      [id],
    ),
    transitions: db.all<PhaseTransition>(
      'SELECT id, from_phase, to_phase, moved_at, reason FROM phase_transitions WHERE project_id = ? ORDER BY moved_at DESC, id DESC LIMIT 30',
      [id],
    ),
  };
}

function projectRow(db: Database, id: number) {
  const p = db.get<{ id: number; customer_id: number; current_phase: Phase; status: string }>(
    'SELECT id, customer_id, current_phase, status FROM projects WHERE id = ?',
    [id],
  );
  if (!p) throw notFound('Projekt');
  return p;
}

function touch(db: Database, id: number) {
  db.run('UPDATE projects SET updated_at = ? WHERE id = ?', [nowIso(), id]);
}

// ---------------------------------------------------------------------
// Vorlagen
// ---------------------------------------------------------------------

export function listTemplates(db: Database): ProjectTemplate[] {
  const templates = db.all<{
    id: number;
    name: string;
    customer_type: ProjectTemplate['customer_type'];
    deliverable_type_id: number | null;
    default_deliverable_count: number;
    phase_offsets_json: string;
    description: string | null;
  }>('SELECT * FROM project_templates WHERE active = 1 ORDER BY customer_type IS NOT NULL, name');
  return templates.map(({ phase_offsets_json, ...t }) => ({
    ...t,
    phase_offsets: JSON.parse(phase_offsets_json || '{}'),
    items: db.all<ProjectTemplate['items'][number]>(
      'SELECT phase, kind, label, is_gate FROM template_checklist_items WHERE template_id = ? ORDER BY phase, sort_order, id',
      [t.id],
    ),
  }));
}

// ---------------------------------------------------------------------
// Anlegen und Bearbeiten
// ---------------------------------------------------------------------

export function createProject(db: Database, data: Out<typeof projectCreateInput>): ProjectDetail {
  const customer = db.get<{ id: number; customer_type: string; archived_at: string | null }>(
    'SELECT id, customer_type, archived_at FROM customers WHERE id = ?',
    [data.customer_id],
  );
  if (!customer) throw new HttpError(400, 'Kunde nicht gefunden');
  if (customer.archived_at) throw new HttpError(400, 'Für archivierte Kunden können keine Projekte angelegt werden');

  const templates = listTemplates(db);
  const template = data.template_id
    ? templates.find((t) => t.id === data.template_id)
    : (templates.find((t) => t.customer_type === customer.customer_type) ?? templates.find((t) => !t.customer_type));
  if (data.template_id && !template) throw new HttpError(400, 'Vorlage nicht gefunden');

  const deliverableTypeId = data.deliverable_type_id ?? template?.deliverable_type_id ?? null;
  if (deliverableTypeId && !db.get('SELECT 1 FROM deliverable_types WHERE id = ?', [deliverableTypeId])) {
    throw new HttpError(400, 'Leistungsart nicht gefunden');
  }
  const now = nowIso();
  const serviceMonth = data.service_month ?? (data.shoot_date ? data.shoot_date.slice(0, 7) : monthBerlin());

  const id = db.transaction(() => {
    const r = db.run(
      `INSERT INTO projects (customer_id, title, description, template_id, deliverable_type_id, deliverable_count,
         service_month, priority, notes, created_at, updated_at)
       VALUES (:customer_id, :title, :description, :template_id, :dt, :count, :month, :priority, :notes, :now, :now)`,
      {
        customer_id: data.customer_id,
        title: data.title,
        description: data.description,
        template_id: template?.id ?? null,
        dt: deliverableTypeId,
        count: data.deliverable_count ?? template?.default_deliverable_count ?? 1,
        month: serviceMonth,
        priority: data.priority,
        notes: data.notes,
        now,
      },
    );
    const projectId = r.lastInsertRowid;

    for (const phase of [1, 2, 3, 4, 5] as Phase[]) {
      let due: string | null = null;
      if (data.shoot_date) {
        const offset = phase === 1 ? 0 : template?.phase_offsets[phase];
        due = offset !== undefined ? addDays(data.shoot_date, offset) : null;
      }
      db.run(
        `INSERT INTO project_phases (project_id, phase, due_date, entered_at) VALUES (:pid, :phase, :due, :entered)`,
        { pid: projectId, phase, due, entered: phase === 1 ? now : null },
      );
    }

    db.run(
      `INSERT INTO shoots (project_id, shoot_date, start_time, end_time, location)
       VALUES (:pid, :date, :start, :end, :location)`,
      { pid: projectId, date: data.shoot_date, start: data.start_time, end: data.end_time, location: data.location },
    );

    (template?.items ?? []).forEach((item, i) => {
      db.run(
        `INSERT INTO checklist_items (project_id, phase, kind, label, is_gate, sort_order)
         VALUES (:pid, :phase, :kind, :label, :gate, :sort)`,
        { pid: projectId, phase: item.phase, kind: item.kind, label: item.label, gate: item.is_gate, sort: i },
      );
    });
    for (const item of SYSTEM_ITEMS) {
      db.run(
        `INSERT INTO checklist_items (project_id, phase, kind, label, is_gate, is_system, auto_key, sort_order)
         VALUES (:pid, :phase, 'standard', :label, :gate, 1, :key, 10000)`,
        { pid: projectId, phase: item.phase, label: item.label, gate: item.is_gate, key: item.auto_key },
      );
    }

    db.run('INSERT INTO phase_transitions (project_id, from_phase, to_phase, moved_at, reason) VALUES (?, NULL, 1, ?, ?)', [
      projectId,
      now,
      'Projekt angelegt',
    ]);
    return projectId;
  });
  return getProject(db, id);
}

export function updateProject(db: Database, id: number, data: Out<typeof projectUpdateInput>): ProjectDetail {
  const current = projectRow(db, id);
  if (data.deliverable_type_id && !db.get('SELECT 1 FROM deliverable_types WHERE id = ?', [data.deliverable_type_id])) {
    throw new HttpError(400, 'Leistungsart nicht gefunden');
  }
  let status = data.status ?? current.status;
  let completedAt: string | null | undefined = undefined;
  if (current.status === 'abgeschlossen' && data.status) {
    completedAt = null; // wieder geöffnet
  } else if (current.status === 'abgeschlossen' && !data.status) {
    status = 'abgeschlossen';
  }
  db.run(
    `UPDATE projects SET title = :title, description = :description, deliverable_type_id = :dt,
       deliverable_count = :count, service_month = :month, priority = :priority, status = :status,
       approval_reminder_days = :days, notes = :notes, updated_at = :now
       ${completedAt === null ? ', completed_at = NULL' : ''}
     WHERE id = :id`,
    {
      id,
      title: data.title,
      description: data.description,
      dt: data.deliverable_type_id,
      count: data.deliverable_count,
      month: data.service_month,
      priority: data.priority,
      status,
      days: data.approval_reminder_days,
      notes: data.notes,
      now: nowIso(),
    },
  );
  return getProject(db, id);
}

export function updateInvoice(db: Database, id: number, d: Out<typeof invoiceInput>): ProjectDetail {
  projectRow(db, id);
  const today = todayBerlin();
  db.run(
    `UPDATE projects SET invoice_status = :status, invoice_number = :number, invoice_amount_cents = :amount,
       invoice_date = :date, paid_date = :paid, updated_at = :now WHERE id = :id`,
    {
      id,
      status: d.invoice_status,
      number: d.invoice_number,
      amount: d.invoice_amount_cents,
      // Datum automatisch setzen, wenn der Status wechselt und kein Datum angegeben ist
      date: d.invoice_date ?? (d.invoice_status !== 'offen' ? today : null),
      paid: d.paid_date ?? (d.invoice_status === 'bezahlt' ? today : null),
      now: nowIso(),
    },
  );
  return getProject(db, id);
}

export function deleteProject(db: Database, id: number): void {
  const r = db.run('DELETE FROM projects WHERE id = ?', [id]);
  if (r.changes === 0) throw notFound('Projekt');
}

// ---------------------------------------------------------------------
// Phasen
// ---------------------------------------------------------------------

export function updatePhase(db: Database, id: number, phase: number, data: Out<typeof phaseUpdateInput>): ProjectDetail {
  projectRow(db, id);
  if (data.assignee_id && !db.get('SELECT 1 FROM team_members WHERE id = ?', [data.assignee_id])) {
    throw new HttpError(400, 'Verantwortlicher nicht gefunden');
  }
  const r = db.run(
    'UPDATE project_phases SET due_date = :due, assignee_id = :assignee, notes = :notes WHERE project_id = :id AND phase = :phase',
    { id, phase, due: data.due_date, assignee: data.assignee_id, notes: data.notes },
  );
  if (r.changes === 0) throw notFound('Phase');
  touch(db, id);
  return getProject(db, id);
}

/**
 * Verschiebt ein Projekt in eine andere Phase.
 * Vorwärts nur, wenn alle Sperrpunkte der verlassenen Phasen erledigt sind.
 */
export function moveProject(db: Database, id: number, toPhase: Phase, reason: string | null = null): ProjectDetail {
  const p = projectRow(db, id);
  if (p.status === 'abgeschlossen' || p.status === 'abgebrochen') {
    throw new HttpError(409, 'Abgeschlossene oder abgebrochene Projekte können nicht verschoben werden. Bitte zuerst wieder öffnen.');
  }
  const from = p.current_phase;
  if (toPhase === from) return getProject(db, id);
  const now = nowIso();

  db.transaction(() => {
    if (toPhase > from) {
      const gate = db.get<{ label: string; phase: Phase }>(
        `SELECT label, phase FROM checklist_items
         WHERE project_id = :id AND phase >= :from AND phase < :to AND is_gate = 1 AND is_done = 0
         ORDER BY phase, sort_order LIMIT 1`,
        { id, from, to: toPhase },
      );
      if (gate) {
        throw new HttpError(
          409,
          `„${gate.label}“ in der Phase ${PHASE_LABELS[gate.phase]} muss abgehakt sein, bevor das Projekt weiterrücken kann.`,
        );
      }
      db.run(
        `UPDATE project_phases SET completed_at = :now
         WHERE project_id = :id AND phase >= :from AND phase < :to AND completed_at IS NULL`,
        { id, from, to: toPhase, now },
      );
      // Freigabe verlassen ohne Entscheidung: gilt als freigegeben
      if (from === 4) {
        db.run(
          `UPDATE approval_rounds SET responded_at = :now, result = 'freigegeben'
           WHERE project_id = :id AND responded_at IS NULL`,
          { id, now },
        );
      }
    } else {
      db.run('UPDATE project_phases SET completed_at = NULL WHERE project_id = :id AND phase >= :to', { id, to: toPhase });
      // Zurück vor die Freigabe: eine noch unbeantwortete Anfrage wird zurückgenommen
      if (from >= 4 && toPhase < 4) {
        db.run('DELETE FROM approval_rounds WHERE project_id = ? AND responded_at IS NULL', [id]);
      }
    }
    db.run(
      'UPDATE project_phases SET entered_at = :now, completed_at = NULL WHERE project_id = :id AND phase = :to',
      { id, to: toPhase, now },
    );
    if (toPhase === 4) openApprovalRound(db, id, now);
    db.run('UPDATE projects SET current_phase = :to, updated_at = :now WHERE id = :id', { id, to: toPhase, now });
    db.run(
      'INSERT INTO phase_transitions (project_id, from_phase, to_phase, moved_at, reason) VALUES (?, ?, ?, ?, ?)',
      [id, from, toPhase, now, reason],
    );
  });
  return getProject(db, id);
}

// ---------------------------------------------------------------------
// Checklisten
// ---------------------------------------------------------------------

function checklistItem(db: Database, itemId: number) {
  const item = db.get<ChecklistItem>('SELECT * FROM checklist_items WHERE id = ?', [itemId]);
  if (!item) throw notFound('Checklistenpunkt');
  return item;
}

export function addChecklistItem(db: Database, projectId: number, data: Out<typeof checklistCreateInput>): ProjectDetail {
  projectRow(db, projectId);
  const max = db.get<{ m: number | null }>(
    'SELECT MAX(sort_order) AS m FROM checklist_items WHERE project_id = ? AND phase = ? AND is_system = 0',
    [projectId, data.phase],
  )!.m;
  db.run(
    `INSERT INTO checklist_items (project_id, phase, kind, label, sort_order) VALUES (:pid, :phase, :kind, :label, :sort)`,
    { pid: projectId, phase: data.phase, kind: data.kind as ChecklistKind, label: data.label, sort: (max ?? 0) + 1 },
  );
  touch(db, projectId);
  return getProject(db, projectId);
}

export function updateChecklistItem(db: Database, itemId: number, data: Out<typeof checklistUpdateInput>): ProjectDetail {
  const item = checklistItem(db, itemId);
  if (data.label !== undefined && item.is_system) throw new HttpError(409, 'Systempunkte können nicht umbenannt werden');
  const isDone = data.is_done ?? !!item.is_done;
  db.run('UPDATE checklist_items SET label = :label, is_done = :done, done_at = :at WHERE id = :id', {
    id: itemId,
    label: data.label ?? item.label,
    done: isDone,
    at: isDone ? (item.is_done ? item.done_at : nowIso()) : null,
  });
  touch(db, item.project_id);
  return getProject(db, item.project_id);
}

export function deleteChecklistItem(db: Database, itemId: number): ProjectDetail {
  const item = checklistItem(db, itemId);
  if (item.is_system) throw new HttpError(409, 'Systempunkte können nicht gelöscht werden');
  db.run('DELETE FROM checklist_items WHERE id = ?', [itemId]);
  touch(db, item.project_id);
  return getProject(db, item.project_id);
}

// ---------------------------------------------------------------------
// Drehtag
// ---------------------------------------------------------------------

export function updateShoot(db: Database, id: number, data: Out<typeof shootInput>): ProjectDetail {
  projectRow(db, id);
  db.run(
    `INSERT INTO shoots (project_id, shoot_date, start_time, end_time, location, location_notes, shotlist_notes)
     VALUES (:id, :date, :start, :end, :location, :lnotes, :snotes)
     ON CONFLICT(project_id) DO UPDATE SET shoot_date = excluded.shoot_date, start_time = excluded.start_time,
       end_time = excluded.end_time, location = excluded.location, location_notes = excluded.location_notes,
       shotlist_notes = excluded.shotlist_notes`,
    {
      id,
      date: data.shoot_date,
      start: data.start_time,
      end: data.end_time,
      location: data.location,
      lnotes: data.location_notes,
      snotes: data.shotlist_notes,
    },
  );
  // Fälligkeit der Phase Drehtag folgt dem Drehdatum
  if (data.shoot_date) {
    db.run('UPDATE project_phases SET due_date = ? WHERE project_id = ? AND phase = 1', [data.shoot_date, id]);
  }
  touch(db, id);
  return getProject(db, id);
}

// ---------------------------------------------------------------------
// Freigabe
// ---------------------------------------------------------------------

function openApprovalRound(db: Database, id: number, at: string) {
  const open = db.get('SELECT 1 FROM approval_rounds WHERE project_id = ? AND responded_at IS NULL', [id]);
  if (open) return;
  const max = db.get<{ m: number | null }>('SELECT MAX(round_no) AS m FROM approval_rounds WHERE project_id = ?', [id])!.m;
  db.run('INSERT INTO approval_rounds (project_id, round_no, requested_at) VALUES (?, ?, ?)', [id, (max ?? 0) + 1, at]);
}

export function decideApproval(db: Database, id: number, data: Out<typeof approvalDecisionInput>): ProjectDetail {
  const p = projectRow(db, id);
  if (p.current_phase !== 4 || p.status !== 'aktiv') throw new HttpError(409, 'Das Projekt wartet derzeit nicht auf eine Freigabe');
  const round = db.get<{ id: number; round_no: number }>(
    'SELECT id, round_no FROM approval_rounds WHERE project_id = ? AND responded_at IS NULL ORDER BY round_no DESC LIMIT 1',
    [id],
  );
  if (!round) throw new HttpError(409, 'Es gibt keine offene Freigabeanfrage');
  const now = nowIso();
  db.transaction(() => {
    db.run('UPDATE approval_rounds SET responded_at = :now, result = :result, feedback = :feedback WHERE id = :rid', {
      rid: round.id,
      now,
      result: data.result,
      feedback: data.feedback,
    });
    if (data.result === 'freigegeben') {
      moveProject(db, id, 5, 'Vom Kunden freigegeben');
    } else if (data.back_to_editing) {
      // Korrigierte Fassung muss erneut geprüft werden
      db.run(
        'UPDATE checklist_items SET is_done = 0, done_at = NULL WHERE project_id = ? AND phase = 2 AND is_gate = 1',
        [id],
      );
      moveProject(db, id, 2, `Korrekturschleife ${round.round_no}`);
    } else {
      // Kleine Korrektur ohne neuen Schnittdurchlauf: sofort neue Runde
      db.run('INSERT INTO approval_rounds (project_id, round_no, requested_at) VALUES (?, ?, ?)', [id, round.round_no + 1, now]);
      touch(db, id);
    }
  });
  return getProject(db, id);
}

export function setApprovalRequestDate(db: Database, id: number, date: string): ProjectDetail {
  projectRow(db, id);
  const r = db.run(
    'UPDATE approval_rounds SET requested_at = :at WHERE project_id = :id AND responded_at IS NULL',
    { id, at: `${date}T10:00:00.000Z` },
  );
  if (r.changes === 0) throw new HttpError(409, 'Es gibt keine offene Freigabeanfrage');
  touch(db, id);
  return getProject(db, id);
}

// ---------------------------------------------------------------------
// Veröffentlichung und Abschluss
// ---------------------------------------------------------------------

function autoComplete(db: Database, id: number) {
  const p = projectRow(db, id);
  if (p.status !== 'aktiv' || p.current_phase !== 5) return;
  const stats = db.get<{ total: number; done: number }>(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'veroeffentlicht' THEN 1 ELSE 0 END) AS done FROM publications WHERE project_id = ?",
    [id],
  )!;
  if (stats.total > 0 && stats.done === stats.total) completeProject(db, id);
}

export function addPublication(db: Database, id: number, data: Out<typeof publicationInput>): ProjectDetail {
  projectRow(db, id);
  const published = !!data.post_url;
  db.run(
    `INSERT INTO publications (project_id, platform, planned_date, planned_time, caption, post_url, status, published_at)
     VALUES (:id, :platform, :date, :time, :caption, :url, :status, :pub)`,
    {
      id,
      platform: data.platform,
      date: data.planned_date,
      time: data.planned_time,
      caption: data.caption,
      url: data.post_url,
      status: published ? 'veroeffentlicht' : 'geplant',
      pub: published ? nowIso() : null,
    },
  );
  touch(db, id);
  autoComplete(db, id);
  return getProject(db, id);
}

export function updatePublication(db: Database, pubId: number, data: Out<typeof publicationInput>): ProjectDetail {
  const pub = db.get<Publication>('SELECT * FROM publications WHERE id = ?', [pubId]);
  if (!pub) throw notFound('Veröffentlichung');
  const published = !!data.post_url;
  db.run(
    `UPDATE publications SET platform = :platform, planned_date = :date, planned_time = :time, caption = :caption,
       post_url = :url, status = :status, published_at = :pub WHERE id = :id`,
    {
      id: pubId,
      platform: data.platform,
      date: data.planned_date,
      time: data.planned_time,
      caption: data.caption,
      url: data.post_url,
      status: published ? 'veroeffentlicht' : 'geplant',
      pub: published ? (pub.published_at ?? nowIso()) : null,
    },
  );
  touch(db, pub.project_id);
  autoComplete(db, pub.project_id);
  return getProject(db, pub.project_id);
}

export function deletePublication(db: Database, pubId: number): ProjectDetail {
  const pub = db.get<Publication>('SELECT * FROM publications WHERE id = ?', [pubId]);
  if (!pub) throw notFound('Veröffentlichung');
  db.run('DELETE FROM publications WHERE id = ?', [pubId]);
  touch(db, pub.project_id);
  return getProject(db, pub.project_id);
}

export function completeProject(db: Database, id: number): ProjectDetail {
  const p = projectRow(db, id);
  if (p.status === 'abgeschlossen') return getProject(db, id);
  if (p.current_phase !== 5) {
    throw new HttpError(409, 'Ein Projekt kann erst in der Phase Veröffentlichung abgeschlossen werden');
  }
  const now = nowIso();
  db.transaction(() => {
    db.run("UPDATE projects SET status = 'abgeschlossen', completed_at = :now, updated_at = :now WHERE id = :id", { id, now });
    db.run('UPDATE project_phases SET completed_at = :now WHERE project_id = :id AND phase = 5', { id, now });
  });
  return getProject(db, id);
}

export function reopenProject(db: Database, id: number): ProjectDetail {
  const p = projectRow(db, id);
  if (p.status !== 'abgeschlossen' && p.status !== 'abgebrochen') return getProject(db, id);
  db.run(
    "UPDATE projects SET status = 'aktiv', completed_at = NULL, updated_at = :now WHERE id = :id",
    { id, now: nowIso() },
  );
  db.run('UPDATE project_phases SET completed_at = NULL WHERE project_id = ? AND phase = ?', [id, p.current_phase]);
  return getProject(db, id);
}
