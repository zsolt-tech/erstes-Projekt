// Engpass-Erkennung: Projekte, die zu lange in einer Phase hängen, verpasste Termine,
// zu viele Drehtage, Häufung von Fristen und Paket-Rückstände.
import type { Database } from '../db/database.ts';
import { addDays, berlinDateOf, daysBetween, monthRange, todayBerlin } from '../lib/time.ts';
import { getSettings } from './settings.ts';
import { packageUsage } from './customers.ts';
import { PHASE_LABELS, type Bottleneck, type Phase } from '../../shared/schemas.ts';

const tage = (n: number) => (n === 1 ? '1 Tag' : `${n} Tagen`);
const fmt = (d: string) => d.split('-').reverse().join('.');

export function detectBottlenecks(db: Database, today = todayBerlin()): Bottleneck[] {
  const limits = getSettings(db).bottleneck_limits;
  const out: Bottleneck[] = [];

  // --- Zu lange in einer Phase ---
  const projects = db.all<{ id: number; title: string; customer: string; current_phase: Phase; entered_at: string | null; shoot_date: string | null; approval_requested_at: string | null; assignee_id: number | null }>(
    `SELECT p.id, p.title, c.company_name AS customer, p.current_phase, ph.entered_at, s.shoot_date, ph.assignee_id,
            (SELECT requested_at FROM approval_rounds ar WHERE ar.project_id = p.id AND ar.responded_at IS NULL ORDER BY round_no DESC LIMIT 1) AS approval_requested_at
     FROM projects p JOIN customers c ON c.id = p.customer_id
     LEFT JOIN project_phases ph ON ph.project_id = p.id AND ph.phase = p.current_phase
     LEFT JOIN shoots s ON s.project_id = p.id
     WHERE p.status = 'aktiv'`,
  );
  const limitFor: Partial<Record<Phase, number>> = { 2: limits.editing_days, 3: limits.upload_days };
  for (const p of projects) {
    const name = `„${p.title}“ (${p.customer})`;
    const url = `/projekte/${p.id}`;
    const days = p.entered_at ? daysBetween(berlinDateOf(p.entered_at), today) : 0;
    const limit = limitFor[p.current_phase];
    if (limit && days > limit) {
      out.push({
        key: `phase:${p.id}:${p.current_phase}`,
        level: days > limit * 2 ? 'hoch' : 'mittel',
        kind: 'phase',
        text: `${name} hängt seit ${tage(days)} in ${PHASE_LABELS[p.current_phase]} (Grenze ${limit}).`,
        url,
      });
    }
    if (p.current_phase === 4 && p.approval_requested_at) {
      const waiting = daysBetween(berlinDateOf(p.approval_requested_at), today);
      if (waiting > limits.approval_days) {
        out.push({ key: `phase:${p.id}:4`, level: 'mittel', kind: 'phase', text: `${name} wartet seit ${tage(waiting)} auf Freigabe.`, url });
      }
    }
    if (p.current_phase === 1 && p.shoot_date && p.shoot_date < today) {
      const since = daysBetween(p.shoot_date, today);
      out.push({
        key: `drehtag:${p.id}`,
        level: since > 3 ? 'hoch' : 'mittel',
        kind: 'drehtag',
        text: `Drehtag von ${name} war am ${fmt(p.shoot_date)}, das Projekt steht noch in der Phase Drehtag.`,
        url,
      });
    }
  }

  // --- Veröffentlichung verpasst ---
  for (const pu of db.all<{ id: number; project_id: number; title: string; customer: string; planned_date: string }>(
    `SELECT pu.id, pu.project_id, p.title, c.company_name AS customer, pu.planned_date
     FROM publications pu JOIN projects p ON p.id = pu.project_id JOIN customers c ON c.id = p.customer_id
     WHERE pu.status = 'geplant' AND pu.planned_date < ? AND p.status = 'aktiv'`,
    [today],
  )) {
    out.push({
      key: `veroeffentlichung:${pu.id}`,
      level: 'mittel',
      kind: 'veroeffentlichung',
      text: `Veröffentlichung von „${pu.title}“ (${pu.customer}) war für den ${fmt(pu.planned_date)} geplant, ein Link fehlt noch.`,
      url: `/projekte/${pu.project_id}`,
    });
  }

  // --- Zu viele Drehtage in den nächsten 7 Tagen ---
  const shoots = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM shoots s JOIN projects p ON p.id = s.project_id
     WHERE p.status IN ('aktiv','pausiert') AND s.shoot_date >= ? AND s.shoot_date < ?`,
    [today, addDays(today, 7)],
  )!.n;
  if (shoots > limits.shoots_per_week) {
    out.push({
      key: `auslastung:drehtage:${today}`,
      level: 'mittel',
      kind: 'auslastung',
      text: `${shoots} Drehtage in den nächsten 7 Tagen (Grenze ${limits.shoots_per_week}). Zeit für Schnitt einplanen.`,
      url: '/kalender',
    });
  }

  // --- Zu viel gleichzeitig in Bearbeitung (je Person, ohne Team insgesamt) ---
  const editing = new Map<string, number>();
  for (const p of projects.filter((x) => x.current_phase === 2)) {
    const key = p.assignee_id ? String(p.assignee_id) : 'ich';
    editing.set(key, (editing.get(key) ?? 0) + 1);
  }
  for (const [key, n] of editing) {
    if (n <= limits.editing_parallel) continue;
    const who = key === 'ich' ? '' : ` bei ${db.get<{ name: string }>('SELECT name FROM team_members WHERE id = ?', [Number(key)])?.name ?? 'einer Person'}`;
    out.push({
      key: `auslastung:bearbeitung:${key}`,
      level: 'hoch',
      kind: 'auslastung',
      text: `${n} Projekte gleichzeitig in Bearbeitung${who} (Grenze ${limits.editing_parallel}).`,
      url: '/projekte',
    });
  }

  // --- Häufung von Fristen an einem Tag (nächste 14 Tage) ---
  const dueByDay = new Map<string, number>();
  for (const r of db.all<{ d: string; n: number }>(
    `SELECT d, COUNT(*) AS n FROM (
       SELECT ph.due_date AS d FROM projects p JOIN project_phases ph ON ph.project_id = p.id AND ph.phase = p.current_phase
       WHERE p.status = 'aktiv' AND ph.due_date >= :from AND ph.due_date < :to
       UNION ALL
       SELECT due_date FROM tasks WHERE status <> 'erledigt' AND due_date >= :from AND due_date < :to
     ) GROUP BY d`,
    { from: today, to: addDays(today, 14) },
  )) {
    dueByDay.set(r.d, r.n);
  }
  for (const [d, n] of dueByDay) {
    if (n >= limits.deadlines_per_day) {
      out.push({ key: `deadlines:${d}`, level: 'mittel', kind: 'deadlines', text: `${n} Fristen am ${fmt(d)}.`, url: '/kalender' });
    }
  }

  // --- Paketverbrauch: Rückstand oder Überschreitung im laufenden Monat ---
  const month = today.slice(0, 7);
  const { end } = monthRange(month);
  const progress = Number(today.slice(8, 10)) / Number(end.slice(8, 10));
  for (const c of db.all<{ id: number; company_name: string }>(
    `SELECT DISTINCT c.id, c.company_name FROM customers c JOIN package_items pi ON pi.customer_id = c.id
     WHERE c.status = 'aktiv' AND c.archived_at IS NULL`,
  )) {
    for (const u of packageUsage(db, c.id, month)) {
      if (u.used > u.quantity) {
        out.push({
          key: `paket:${c.id}:${u.deliverable_type_id}:${month}:ueber`,
          level: 'mittel',
          kind: 'paket',
          text: `${c.company_name}: ${u.used} von ${u.quantity} × ${u.deliverable_type_name} angelegt, ${u.used - u.quantity} über dem Paket.`,
          url: `/kunden/${c.id}`,
        });
      } else if (progress >= 2 / 3 && u.used < u.quantity / 2) {
        out.push({
          key: `paket:${c.id}:${u.deliverable_type_id}:${month}:rueckstand`,
          level: 'hoch',
          kind: 'paket',
          text: `${c.company_name}: erst ${u.used} von ${u.quantity} × ${u.deliverable_type_name} angelegt, der Monat ist zu zwei Dritteln vorbei.`,
          url: `/kunden/${c.id}`,
        });
      }
    }
  }

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'hoch' ? -1 : 1));
}
