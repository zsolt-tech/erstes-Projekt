// Aufgaben: frei oder an Kunde, Projekt und Phase gebunden.
import type { Database } from '../db/database.ts';
import { HttpError, notFound } from '../lib/http.ts';
import { addDays, nowIso, todayBerlin } from '../lib/time.ts';
import type { Task, TaskStatus } from '../../shared/schemas.ts';
import type { z } from 'zod';
import type { taskInput } from '../../shared/schemas.ts';

const SELECT = `
  SELECT t.*, c.company_name AS customer_name, p.title AS project_title, tm.name AS assignee_name
  FROM tasks t
  LEFT JOIN customers c ON c.id = t.customer_id
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN team_members tm ON tm.id = t.assignee_id`;

export interface TaskFilter {
  status?: 'offen' | 'erledigt' | 'alle';
  customer_id?: number;
  project_id?: number;
  range?: 'ueberfaellig' | 'heute' | 'woche';
}

export function listTasks(db: Database, filter: TaskFilter = {}): Task[] {
  const where: string[] = [];
  const params: Record<string, unknown> = { today: todayBerlin() };
  const status = filter.status ?? 'offen';
  if (status === 'offen') where.push("t.status <> 'erledigt'");
  if (status === 'erledigt') where.push("t.status = 'erledigt'");
  if (filter.customer_id) {
    where.push('t.customer_id = :cid');
    params.cid = filter.customer_id;
  }
  if (filter.project_id) {
    where.push('t.project_id = :pid');
    params.pid = filter.project_id;
  }
  // Aufgaben archivierter Kunden stehen nur noch auf der Kunden- und Projektseite
  if (!filter.customer_id && !filter.project_id) where.push('c.archived_at IS NULL');
  if (filter.range === 'ueberfaellig') where.push('t.due_date < :today');
  if (filter.range === 'heute') where.push('t.due_date <= :today');
  if (filter.range === 'woche') {
    where.push('t.due_date <= :week');
    params.week = addDays(params.today as string, 7);
  }
  return db.all<Task>(
    `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE WHEN t.status = 'erledigt' THEN 1 ELSE 0 END,
              CASE WHEN t.status = 'erledigt' THEN t.completed_at END DESC,
              COALESCE(t.due_date, '9999-12-31'), COALESCE(t.due_time, '99:99'),
              CASE t.priority WHEN 'hoch' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.id`,
    params,
  );
}

export function getTask(db: Database, id: number): Task {
  const t = db.get<Task>(`${SELECT} WHERE t.id = ?`, [id]);
  if (!t) throw notFound('Aufgabe');
  return t;
}

function resolveLinks(db: Database, data: z.output<typeof taskInput>) {
  let customerId = data.customer_id;
  if (data.project_id) {
    const p = db.get<{ customer_id: number }>('SELECT customer_id FROM projects WHERE id = ?', [data.project_id]);
    if (!p) throw new HttpError(400, 'Projekt nicht gefunden');
    customerId = p.customer_id; // Aufgabe gehört immer zum Kunden des Projekts
  }
  if (customerId && !db.get('SELECT 1 FROM customers WHERE id = ?', [customerId])) {
    throw new HttpError(400, 'Kunde nicht gefunden');
  }
  if (data.assignee_id && !db.get('SELECT 1 FROM team_members WHERE id = ?', [data.assignee_id])) {
    throw new HttpError(400, 'Verantwortlicher nicht gefunden');
  }
  return { customerId, phase: data.project_id ? data.phase : null };
}

export function createTask(db: Database, data: z.output<typeof taskInput>): Task {
  const { customerId, phase } = resolveLinks(db, data);
  const now = nowIso();
  const r = db.run(
    `INSERT INTO tasks (title, description, customer_id, project_id, phase, due_date, due_time, assignee_id,
       priority, status, completed_at, created_at, updated_at)
     VALUES (:title, :description, :cid, :pid, :phase, :due, :time, :assignee, :priority, :status, :completed, :now, :now)`,
    {
      title: data.title,
      description: data.description,
      cid: customerId,
      pid: data.project_id,
      phase,
      due: data.due_date,
      time: data.due_time,
      assignee: data.assignee_id,
      priority: data.priority,
      status: data.status,
      completed: data.status === 'erledigt' ? now : null,
      now,
    },
  );
  return getTask(db, r.lastInsertRowid);
}

export function updateTask(db: Database, id: number, data: z.output<typeof taskInput>): Task {
  const current = getTask(db, id);
  const { customerId, phase } = resolveLinks(db, data);
  const now = nowIso();
  db.run(
    `UPDATE tasks SET title = :title, description = :description, customer_id = :cid, project_id = :pid, phase = :phase,
       due_date = :due, due_time = :time, assignee_id = :assignee, priority = :priority, status = :status,
       completed_at = :completed, updated_at = :now WHERE id = :id`,
    {
      id,
      title: data.title,
      description: data.description,
      cid: customerId,
      pid: data.project_id,
      phase,
      due: data.due_date,
      time: data.due_time,
      assignee: data.assignee_id,
      priority: data.priority,
      status: data.status,
      completed: data.status === 'erledigt' ? (current.completed_at ?? now) : null,
      now,
    },
  );
  return getTask(db, id);
}

export function setTaskStatus(db: Database, id: number, status: TaskStatus): Task {
  const current = getTask(db, id);
  const now = nowIso();
  db.run('UPDATE tasks SET status = :status, completed_at = :completed, updated_at = :now WHERE id = :id', {
    id,
    status,
    completed: status === 'erledigt' ? (current.completed_at ?? now) : null,
    now,
  });
  return getTask(db, id);
}

export function deleteTask(db: Database, id: number): void {
  const r = db.run('DELETE FROM tasks WHERE id = ?', [id]);
  if (r.changes === 0) throw notFound('Aufgabe');
}
