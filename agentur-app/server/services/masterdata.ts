// Stammdaten: Leistungsarten und Team.
import type { Database } from '../db/database.ts';
import { HttpError, notFound } from '../lib/http.ts';
import type { DeliverableType, TeamMember } from '../../shared/schemas.ts';

// --- Leistungsarten ---

export function listDeliverableTypes(db: Database): DeliverableType[] {
  return db.all<DeliverableType>('SELECT * FROM deliverable_types ORDER BY sort_order, name');
}

export function createDeliverableType(db: Database, data: { name: string; sort_order?: number }): DeliverableType {
  if (db.get('SELECT 1 FROM deliverable_types WHERE name = ? COLLATE NOCASE', [data.name])) {
    throw new HttpError(409, 'Diese Leistungsart gibt es bereits');
  }
  const max = db.get<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM deliverable_types')!.m ?? 0;
  const r = db.run('INSERT INTO deliverable_types (name, sort_order) VALUES (:name, :sort)', {
    name: data.name,
    sort: data.sort_order ?? max + 10,
  });
  return db.get<DeliverableType>('SELECT * FROM deliverable_types WHERE id = ?', [r.lastInsertRowid])!;
}

export function updateDeliverableType(
  db: Database,
  id: number,
  data: { name: string; sort_order?: number; active?: boolean },
): DeliverableType {
  const current = db.get<DeliverableType>('SELECT * FROM deliverable_types WHERE id = ?', [id]);
  if (!current) throw notFound('Leistungsart');
  if (db.get('SELECT 1 FROM deliverable_types WHERE name = ? COLLATE NOCASE AND id <> ?', [data.name, id])) {
    throw new HttpError(409, 'Diese Leistungsart gibt es bereits');
  }
  db.run('UPDATE deliverable_types SET name = :name, sort_order = :sort, active = :active WHERE id = :id', {
    id,
    name: data.name,
    sort: data.sort_order ?? current.sort_order,
    active: data.active ?? Boolean(current.active),
  });
  return db.get<DeliverableType>('SELECT * FROM deliverable_types WHERE id = ?', [id])!;
}

// --- Team ---

export function listTeam(db: Database): TeamMember[] {
  return db.all<TeamMember>('SELECT * FROM team_members ORDER BY active DESC, name COLLATE NOCASE');
}

export function createTeamMember(
  db: Database,
  data: { name: string; email: string | null; color?: string; weekly_capacity_h: number | null },
): TeamMember {
  const r = db.run(
    `INSERT INTO team_members (name, email, color, weekly_capacity_h)
     VALUES (:name, :email, :color, :cap)`,
    { name: data.name, email: data.email, color: data.color || '#3B5BDB', cap: data.weekly_capacity_h },
  );
  return db.get<TeamMember>('SELECT * FROM team_members WHERE id = ?', [r.lastInsertRowid])!;
}

export function updateTeamMember(
  db: Database,
  id: number,
  data: { name: string; email: string | null; color?: string; weekly_capacity_h: number | null; active?: boolean },
): TeamMember {
  const current = db.get<TeamMember>('SELECT * FROM team_members WHERE id = ?', [id]);
  if (!current) throw notFound('Teammitglied');
  db.run(
    `UPDATE team_members SET name = :name, email = :email, color = :color,
       weekly_capacity_h = :cap, active = :active WHERE id = :id`,
    {
      id,
      name: data.name,
      email: data.email,
      color: data.color || current.color,
      cap: data.weekly_capacity_h,
      active: data.active ?? Boolean(current.active),
    },
  );
  return db.get<TeamMember>('SELECT * FROM team_members WHERE id = ?', [id])!;
}
