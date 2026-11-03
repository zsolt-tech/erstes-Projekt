// Live-Dashboard: Kennzahlen, Projekte je Phase, Engpässe, heute, die nächsten 14 Tage,
// laufende Projekte, Durchlaufzeit und Paketverbrauch. Aktualisiert sich über die Live-Verbindung.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, Radio, TriangleAlert } from 'lucide-react';
import { useDashboard } from '../api/dashboard';
import { Badge, Card, ErrorBox, PageHeader, ProgressBar, Spinner, cx } from '../components/ui';
import { berlinDate, formatDate, formatMonth } from '../lib/format';
import {
  CALENDAR_KINDS,
  CALENDAR_KIND_LABELS,
  PHASE_LABELS,
  type CalendarItem,
  type CalendarKind,
  type DashboardData,
} from '../../../shared/schemas';

const timeFmt = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const num = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

const tage = (n: number) => (n === 1 ? '1 Tag' : `${num.format(n)} Tage`);
/** "seit 1 Tag", "seit 5 Tagen" */
const seit = (n: number) => (n === 0 ? 'seit heute' : n === 1 ? 'seit 1 Tag' : `seit ${num.format(n)} Tagen`);
const anzahl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Google-Termine haben UTC-Zeitpunkte, App-Einträge Ortszeit "YYYY-MM-DDTHH:MM" */
const isInstant = (v: string) => /Z$|[+-]\d{2}:\d{2}$/.test(v);
const dayOf = (i: CalendarItem) => (i.all_day || !isInstant(i.start) ? i.start.slice(0, 10) : berlinDate(i.start));
const timeOf = (v: string) => (isInstant(v) ? timeFmt.format(new Date(v)) : v.slice(11, 16));

/** Läuft der Eintrag gerade? (für die Markierung „jetzt“) */
function runningNow(i: CalendarItem, now: Date): boolean {
  if (i.all_day || !i.end) return false;
  return new Date(i.start) <= now && now < new Date(i.end);
}

/** Aktuelle Uhrzeit, jede Minute neu */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// ---------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------

function StatTile({ label, value, sub, to, alert, className }: { label: string; value: ReactNode; sub?: ReactNode; to?: string; alert?: ReactNode; className?: string }) {
  const body = (
    <>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-fg tabular">{value}</div>
      {alert ? (
        <div className="mt-1 flex items-center gap-1 text-xs font-medium text-danger">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {alert}
        </div>
      ) : sub ? (
        <div className="mt-1 text-xs text-muted">{sub}</div>
      ) : null}
    </>
  );
  const cls = cx('block rounded-lg border border-line bg-surface p-4', className);
  return to ? (
    <Link to={to} className={cx(cls, 'transition-colors hover:border-line-strong')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function KindDot({ kind }: { kind: CalendarKind }) {
  return <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--cal-${kind})` }} aria-hidden />;
}

function KindLegend({ kinds }: { kinds: CalendarKind[] }) {
  if (kinds.length < 2) return null;
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legende">
      {kinds.map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <KindDot kind={k} />
          {CALENDAR_KIND_LABELS[k]}
        </li>
      ))}
    </ul>
  );
}

function ItemRow({ item, now, showTime = true }: { item: CalendarItem; now: Date; showTime?: boolean }) {
  const live = runningNow(item, now);
  const content = (
    <>
      {showTime && <span className="w-16 shrink-0 text-muted tabular">{item.all_day ? 'ganztägig' : timeOf(item.start)}</span>}
      <KindDot kind={item.kind} />
      <span className="min-w-0 flex-1">{item.title}</span>
      {live && (
        <Badge tone="accent">
          <Radio className="mr-1 size-3" aria-hidden />
          läuft gerade
        </Badge>
      )}
    </>
  );
  const cls = '-mx-2 flex items-center gap-2.5 rounded px-2 py-1.5 text-sm text-fg';
  return (
    <li>
      {item.url ? (
        <Link to={item.url} className={cx(cls, 'hover:bg-surface-2')}>
          {content}
        </Link>
      ) : item.external_url ? (
        <a href={item.external_url} target="_blank" rel="noreferrer" className={cx(cls, 'hover:bg-surface-2')}>
          {content}
        </a>
      ) : (
        <div className={cls}>{content}</div>
      )}
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-subtle">{children}</p>;
}

// ---------------------------------------------------------------------
// Abschnitte
// ---------------------------------------------------------------------

/** Projekte je Phase: ein Balken je Phase in Workflow-Reihenfolge, eine Farbe, Wert an der Balkenspitze */
function PhaseBars({ phases }: { phases: DashboardData['phases'] }) {
  const max = Math.max(1, ...phases.map((p) => p.count));
  const total = phases.reduce((s, p) => s + p.count, 0);
  return (
    <Card title={`Laufende Projekte je Phase (${total})`}>
      <ul className="grid gap-2.5">
        {phases.map((p) => {
          const detail = `${PHASE_LABELS[p.phase]}: ${p.count} ${p.count === 1 ? 'Projekt' : 'Projekte'}${p.overdue ? `, davon ${p.overdue} überfällig` : ''}${p.avg_days !== null ? `, im Schnitt ${tage(p.avg_days)} in der Phase` : ''}`;
          return (
            <li key={p.phase}>
              <Link to="/projekte" title={detail} aria-label={detail} className="group grid items-center gap-x-3 gap-y-1 rounded focus-visible:outline-2 focus-visible:outline-accent sm:grid-cols-[9rem_1fr]">
                <span className="text-sm text-fg">
                  <span className="text-subtle tabular">{p.phase}</span> {PHASE_LABELS[p.phase]}
                </span>
                {/* Balken wächst von links, Wert direkt an der Spitze; Platz für Wert und Hinweis bleibt frei */}
                <span className="flex min-w-0 items-center gap-2">
                  {p.count > 0 && (
                    <span
                      className="h-4 shrink-0 rounded-r bg-accent transition-[width] group-hover:opacity-85"
                      style={{ width: `calc((100% - 8rem) * ${p.count / max})`, minWidth: 4 }}
                    />
                  )}
                  <span className="shrink-0 text-sm text-fg tabular">{p.count}</span>
                  {p.overdue > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-danger">
                      <TriangleAlert className="size-3" aria-hidden />
                      {p.overdue} überfällig
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted">Ohne pausierte Projekte. Die durchschnittliche Zeit in der Phase erscheint beim Darüberfahren.</p>
    </Card>
  );
}

function Warnings({ warnings }: { warnings: DashboardData['warnings'] }) {
  return (
    <Card title={`Engpässe (${warnings.length})`}>
      {warnings.length === 0 ? (
        <Empty>Keine Engpässe erkannt.</Empty>
      ) : (
        <ul className="grid gap-1">
          {warnings.map((w) => {
            const row = (
              <>
                <Badge tone={w.level === 'hoch' ? 'danger' : 'warning'}>
                  {w.level === 'hoch' ? <TriangleAlert className="mr-1 size-3" aria-hidden /> : <CircleAlert className="mr-1 size-3" aria-hidden />}
                  {w.level === 'hoch' ? 'Hoch' : 'Mittel'}
                </Badge>
                <span className="min-w-0 flex-1">{w.text}</span>
              </>
            );
            const cls = '-mx-2 flex items-start gap-2.5 rounded px-2 py-1.5 text-sm text-fg';
            return (
              <li key={w.key}>
                {w.url ? (
                  <Link to={w.url} className={cx(cls, 'hover:bg-surface-2')}>
                    {row}
                  </Link>
                ) : (
                  <div className={cls}>{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">
        Schwellen unter <Link to="/einstellungen" className="text-accent hover:underline">Einstellungen</Link>.
      </p>
    </Card>
  );
}

function Today({ data, now }: { data: DashboardData; now: Date }) {
  const kinds = CALENDAR_KINDS.filter((k) => data.today.some((i) => i.kind === k));
  return (
    <Card title={`Heute, ${dayFmt.format(new Date(`${data.date}T12:00:00`))}`}>
      <KindLegend kinds={kinds} />
      {data.today.length === 0 ? <Empty>Heute keine Termine und keine Fristen.</Empty> : (
        <ul>
          {data.today.map((i) => (
            <ItemRow key={i.id} item={i} now={now} />
          ))}
        </ul>
      )}
      {data.overdue.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-danger">
            <TriangleAlert className="size-3.5" aria-hidden />
            Überfällig ({data.overdue.length})
          </h3>
          <ul>
            {data.overdue.map((o, n) => (
              <li key={n}>
                <Link to={o.url ?? '/aufgaben'} className="-mx-2 flex items-baseline gap-3 rounded px-2 py-1.5 text-sm text-fg hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    {o.title}
                    {o.customer && <span className="text-muted"> · {o.customer}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{seit(o.days)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.approvals.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-[13px] font-semibold text-fg">Warten auf Freigabe ({data.approvals.length})</h3>
          <ul>
            {data.approvals.map((a, n) => (
              <li key={n}>
                <Link to={a.url} className="-mx-2 flex items-baseline gap-3 rounded px-2 py-1.5 text-sm text-fg hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    {a.title}
                    <span className="text-muted"> · {a.customer}</span>
                  </span>
                  <span className={cx('shrink-0 text-xs', a.follow_up ? 'font-medium text-warning' : 'text-muted')}>
                    {seit(a.waiting_days)}
                    {a.follow_up ? ', nachfassen' : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Upcoming({ items, now }: { items: CalendarItem[]; now: Date }) {
  const days = new Map<string, CalendarItem[]>();
  for (const i of items) days.set(dayOf(i), [...(days.get(dayOf(i)) ?? []), i]);
  const sorted = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  const kinds = CALENDAR_KINDS.filter((k) => items.some((i) => i.kind === k));
  return (
    <Card title="Nächste 14 Tage">
      <KindLegend kinds={kinds} />
      {sorted.length === 0 ? (
        <Empty>In den nächsten 14 Tagen steht nichts an.</Empty>
      ) : (
        <div className="grid max-h-[32rem] gap-3 overflow-y-auto pr-1">
          {sorted.map(([day, list]) => (
            <section key={day}>
              <h3 className="mb-0.5 text-xs font-semibold tracking-wide text-muted uppercase">{dayFmt.format(new Date(`${day}T12:00:00`))}</h3>
              <ul>
                {list.map((i) => (
                  <ItemRow key={i.id} item={i} now={now} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

function RunningProjects({ projects }: { projects: DashboardData['projects'] }) {
  return (
    <Card title={`Laufende Projekte (${projects.length})`} padded={false}>
      {projects.length === 0 ? (
        <div className="p-4">
          <Empty>Keine laufenden Projekte.</Empty>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Projekt</th>
                <th className="px-4 py-2.5 font-medium">Phase</th>
                <th className="px-4 py-2.5 font-medium">Seit</th>
                <th className="px-4 py-2.5 font-medium">Fällig</th>
                <th className="w-40 px-4 py-2.5 font-medium">Fortschritt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <Link to={`/projekte/${p.id}`} className="font-medium text-fg hover:text-accent">
                      {p.title}
                    </Link>
                    <div className="text-xs text-muted">{p.customer_name}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-subtle tabular">{p.current_phase}</span> {PHASE_LABELS[p.current_phase]}
                    {p.status === 'pausiert' && (
                      <span className="ml-2">
                        <Badge>pausiert</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted tabular">{p.days_in_phase === null ? '' : p.days_in_phase === 0 ? 'heute' : tage(p.days_in_phase)}</td>
                  <td className="px-4 py-2.5 tabular">
                    {p.phase_due_date ? (
                      p.overdue ? (
                        <span className="inline-flex items-center gap-1 font-medium text-danger">
                          <TriangleAlert className="size-3.5" aria-hidden />
                          {formatDate(p.phase_due_date)}
                        </span>
                      ) : (
                        <span className="text-fg">{formatDate(p.phase_due_date)}</span>
                      )
                    ) : (
                      <span className="text-subtle">offen</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <ProgressBar value={p.progress} max={100} />
                      <span className="w-9 shrink-0 text-right text-xs text-muted tabular">{p.progress} %</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function LeadTime({ lead }: { lead: DashboardData['lead_time'] }) {
  return (
    <Card title="Durchlaufzeit Drehtag bis Veröffentlichung">
      {lead.count === 0 ? (
        <Empty>Noch keine veröffentlichten Projekte in den letzten 90 Tagen. Gezählt wird ab der ersten Veröffentlichung, die als veröffentlicht markiert ist.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <span className="text-4xl font-semibold text-fg tabular">{num.format(lead.avg_days ?? 0)}</span>
              <span className="ml-1.5 text-sm text-muted">Tage im Schnitt</span>
            </div>
            <div className="text-sm text-muted">
              Median {tage(lead.median_days ?? 0)} · {lead.count} {lead.count === 1 ? 'Projekt' : 'Projekte'} seit {formatDate(lead.since)}
            </div>
          </div>
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1.5 font-medium">Projekt</th>
                <th className="py-1.5 font-medium">Dreh</th>
                <th className="py-1.5 font-medium">Veröffentlicht</th>
                <th className="py-1.5 text-right font-medium">Tage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lead.projects.slice(0, 8).map((p) => (
                <tr key={p.project_id}>
                  <td className="py-1.5 pr-2">
                    <Link to={`/projekte/${p.project_id}`} className="text-fg hover:text-accent">
                      {p.title}
                    </Link>
                    <span className="text-muted"> · {p.customer}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-muted tabular">{formatDate(p.shoot_date)}</td>
                  <td className="py-1.5 pr-2 text-muted tabular">{formatDate(p.published_date)}</td>
                  <td className="py-1.5 text-right text-fg tabular">{p.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

function Packages({ packages }: { packages: DashboardData['packages'] }) {
  const month = packages[0]?.month;
  return (
    <Card title={month ? `Paketverbrauch ${formatMonth(month)}` : 'Paketverbrauch'}>
      {packages.length === 0 ? (
        <Empty>Keine aktiven Kunden mit gebuchtem Paket.</Empty>
      ) : (
        <ul className="grid gap-3">
          {packages.map((p) => (
            <li key={p.customer_id}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <Link to={`/kunden/${p.customer_id}`} className="min-w-0 truncate font-medium text-fg hover:text-accent">
                  {p.customer}
                </Link>
                {p.status === 'ueber' && (
                  <Badge tone="warning">
                    <CircleAlert className="mr-1 size-3" aria-hidden />
                    über Paket
                  </Badge>
                )}
                {p.status === 'rueckstand' && (
                  <Badge tone="warning">
                    <CircleAlert className="mr-1 size-3" aria-hidden />
                    Rückstand
                  </Badge>
                )}
              </div>
              <ul className="grid gap-1">
                {p.items.map((i) => (
                  <li key={i.type} className="flex items-center gap-2 text-xs text-muted">
                    <span className="w-24 shrink-0 truncate">{i.type}</span>
                    <ProgressBar value={i.used} max={i.quantity} tone={i.used > i.quantity ? 'warning' : 'accent'} />
                    <span className="w-14 shrink-0 text-right text-fg tabular">
                      {i.used} von {i.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// Seite
// ---------------------------------------------------------------------

export function DashboardPage() {
  const { data, isLoading, error, dataUpdatedAt } = useDashboard();
  const now = useNow();

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error || new Error('Dashboard nicht verfügbar')} />;

  const k = data.kpis;
  const overdue = k.overdue_tasks + k.overdue_deadlines;
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Stand ${timeFmt.format(new Date(dataUpdatedAt || data.generated_at))} Uhr, aktualisiert sich automatisch`}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Aktive Projekte" value={k.active_projects} sub={k.paused_projects ? `${k.paused_projects} pausiert` : `${k.active_customers} aktive Kunden`} to="/projekte" />
        <StatTile
          label="Überfällig"
          value={overdue}
          to="/aufgaben"
          alert={
            overdue
              ? [k.overdue_tasks ? anzahl(k.overdue_tasks, 'Aufgabe', 'Aufgaben') : null, k.overdue_deadlines ? anzahl(k.overdue_deadlines, 'Phasenfrist', 'Phasenfristen') : null]
                  .filter(Boolean)
                  .join(', ')
              : undefined
          }
          sub="Aufgaben und Phasenfristen"
        />
        <StatTile
          label="Warten auf Freigabe"
          value={k.open_approvals}
          sub={k.longest_approval_days !== null ? `längste ${seit(k.longest_approval_days)}` : 'keine offen'}
          to="/projekte"
        />
        <StatTile label="Drehtage, nächste 7 Tage" value={k.shoots_next_7} sub={`${anzahl(k.publications_next_7, 'Veröffentlichung', 'Veröffentlichungen')} geplant`} to="/kalender" />
        <StatTile
          label="Durchlaufzeit Dreh bis Veröffentlichung"
          value={data.lead_time.avg_days === null ? '–' : `${num.format(data.lead_time.avg_days)} Tage`}
          sub={data.lead_time.count ? `Ø aus ${anzahl(data.lead_time.count, 'Projekt', 'Projekten')}, 90 Tage` : 'noch keine Werte'}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      <div className="mb-5 grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <PhaseBars phases={data.phases} />
        <Warnings warnings={data.warnings} />
      </div>

      <div className="mb-5 grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
        <Today data={data} now={now} />
        <Upcoming items={data.upcoming} now={now} />
      </div>

      <div className="mb-5 min-w-0">
        <RunningProjects projects={data.projects} />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
        <LeadTime lead={data.lead_time} />
        <Packages packages={data.packages} />
      </div>
    </>
  );
}
