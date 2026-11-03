// Live-Dashboard: laufende Projekte, heute, die nächsten 14 Tage und Kennzahlen.
import type { Database } from '../db/database.ts';
import type { Services } from '../google/index.ts';
import { addDays, berlinDateOf, daysBetween, nowIso, todayBerlin } from '../lib/time.ts';
import { listProjects } from './projects.ts';
import { PHASES, type DashboardData, type LeadTimeProject, type ProjectListItem } from '../../shared/schemas.ts';

const LEAD_TIME_DAYS = 90;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** Dringlichkeit für die Liste der laufenden Projekte: überfällig, dann nach Fälligkeit, Pausierte zuletzt */
function urgency(a: ProjectListItem, b: ProjectListItem): number {
  if ((a.status === 'pausiert') !== (b.status === 'pausiert')) return a.status === 'pausiert' ? 1 : -1;
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  const da = a.phase_due_date ?? '9999-12-31';
  const dbb = b.phase_due_date ?? '9999-12-31';
  return da === dbb ? b.current_phase - a.current_phase : da.localeCompare(dbb);
}

/** Durchlaufzeit Drehtag bis erste Veröffentlichung */
export function leadTimes(db: Database, today = todayBerlin()): DashboardData['lead_time'] {
  const since = addDays(today, -LEAD_TIME_DAYS);
  const rows = db.all<{ project_id: number; title: string; customer: string; shoot_date: string; planned_date: string | null; published_at: string | null }>(
    `SELECT p.id AS project_id, p.title, c.company_name AS customer, s.shoot_date, pu.planned_date, pu.published_at
     FROM projects p JOIN customers c ON c.id = p.customer_id
     JOIN shoots s ON s.project_id = p.id AND s.shoot_date IS NOT NULL
     JOIN publications pu ON pu.project_id = p.id AND pu.status = 'veroeffentlicht'
     WHERE p.status <> 'abgebrochen'`,
  );
  const first = new Map<number, LeadTimeProject>();
  for (const r of rows) {
    // Der Link wird oft erst Tage nach dem Posten eingetragen: der frühere Wert aus geplantem Datum
    // und Zeitpunkt der Markierung gilt als Veröffentlichungstag
    const marked = r.published_at ? (r.published_at.length > 10 ? berlinDateOf(r.published_at) : r.published_at) : null;
    const published = [r.planned_date, marked].filter((d): d is string => !!d).sort()[0];
    if (!published || published < r.shoot_date) continue;
    const prev = first.get(r.project_id);
    if (!prev || published < prev.published_date) {
      first.set(r.project_id, {
        project_id: r.project_id,
        title: r.title,
        customer: r.customer,
        shoot_date: r.shoot_date,
        published_date: published,
        days: daysBetween(r.shoot_date, published),
      });
    }
  }
  const projects = [...first.values()].filter((p) => p.published_date >= since && p.published_date <= today).sort((a, b) => b.published_date.localeCompare(a.published_date));
  const days = projects.map((p) => p.days);
  return {
    avg_days: round1(days.length ? days.reduce((s, d) => s + d, 0) / days.length : null),
    median_days: round1(median(days)),
    count: projects.length,
    since,
    projects,
  };
}

export function dashboard(db: Database, services: Services): DashboardData {
  const today = todayBerlin();
  const briefing = services.briefing.build(today);
  const projects = listProjects(db, { scope: 'offen' }).sort(urgency);
  const active = projects.filter((p) => p.status === 'aktiv');

  const phases = PHASES.map((phase) => {
    const inPhase = active.filter((p) => p.current_phase === phase);
    const days = inPhase.map((p) => p.days_in_phase).filter((d): d is number => d !== null);
    return {
      phase,
      count: inPhase.length,
      overdue: inPhase.filter((p) => p.overdue).length,
      avg_days: round1(days.length ? days.reduce((s, d) => s + d, 0) / days.length : null),
    };
  });

  const todayItems = services.calendar.items(today, addDays(today, 1));
  const upcoming = services.calendar.items(addDays(today, 1), addDays(today, 15));
  // Nächste 7 Tage wie im Briefing: morgen bis in 7 Tagen (heute steht unter „Heute“)
  const week = upcoming.filter((i) => i.start.slice(0, 10) <= addDays(today, 7));
  const count = (sql: string, params: unknown[] = []) => db.get<{ n: number }>(sql, params as never)!.n;

  return {
    generated_at: nowIso(),
    date: today,
    kpis: {
      active_projects: active.length,
      paused_projects: projects.length - active.length,
      active_customers: count("SELECT COUNT(*) AS n FROM customers WHERE status = 'aktiv' AND archived_at IS NULL"),
      overdue_tasks: count(
        `SELECT COUNT(*) AS n FROM tasks t LEFT JOIN customers c ON c.id = t.customer_id
         WHERE t.status <> 'erledigt' AND t.due_date < ? AND c.archived_at IS NULL`,
        [today],
      ),
      overdue_deadlines: active.filter((p) => p.overdue).length,
      open_approvals: briefing.approvals.length,
      longest_approval_days: briefing.approvals.length ? Math.max(...briefing.approvals.map((a) => a.waiting_days)) : null,
      shoots_next_7: week.filter((i) => i.kind === 'drehtag').length,
      // Nur noch geplante, nicht schon veröffentlichte Beiträge
      publications_next_7: count(
        `SELECT COUNT(*) AS n FROM publications pu JOIN projects p ON p.id = pu.project_id JOIN customers c ON c.id = p.customer_id
         WHERE pu.status = 'geplant' AND pu.planned_date > ? AND pu.planned_date <= ? AND p.status <> 'abgebrochen' AND c.archived_at IS NULL`,
        [today, addDays(today, 7)],
      ),
    },
    phases,
    lead_time: leadTimes(db, today),
    today: todayItems,
    overdue: briefing.overdue,
    approvals: briefing.approvals,
    upcoming,
    projects,
    packages: briefing.packages,
    warnings: briefing.warnings,
  };
}
