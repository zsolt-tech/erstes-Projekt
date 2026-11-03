// Startseite: Kennzahlen und das tägliche Briefing.
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, Plus, RefreshCw, Send } from 'lucide-react';
import { useCustomers, useSettings } from '../api/hooks';
import { useProjects, useTasks } from '../api/projects';
import { useBriefingToday, useGenerateBriefing } from '../api/briefing';
import { Badge, Button, Card, ErrorBox, PageHeader, ProgressBar, Spinner, cx } from '../components/ui';
import { useToast } from '../components/feedback';
import { formatDate, formatDateTime, formatLongDate, formatMonth, today } from '../lib/format';
import type { BriefingData } from '../../../shared/schemas';

function Stat({ label, value, to, tone }: { label: string; value: number | string; to: string; tone?: 'danger' | 'warning' }) {
  return (
    <Link to={to} className="rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-fg')}>{value}</div>
    </Link>
  );
}

function Section({ title, count, children, empty }: { title: string; count?: number; children: ReactNode; empty: string }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg">
        {title}
        {count ? <span className="rounded bg-surface-3 px-1.5 text-xs font-medium text-muted tabular">{count}</span> : null}
      </h3>
      {count === 0 ? <p className="text-sm text-subtle">{empty}</p> : children}
    </section>
  );
}

function Row({ to, children, meta }: { to: string | null; children: ReactNode; meta?: ReactNode }) {
  const content = (
    <>
      <span className="min-w-0 flex-1">{children}</span>
      {meta && <span className="shrink-0 text-xs text-muted">{meta}</span>}
    </>
  );
  return (
    <li>
      {to ? (
        <Link to={to} className="-mx-2 flex items-baseline gap-3 rounded px-2 py-1.5 text-sm text-fg hover:bg-surface-2">
          {content}
        </Link>
      ) : (
        <div className="flex items-baseline gap-3 py-1.5 text-sm">{content}</div>
      )}
    </li>
  );
}

const tage = (n: number) => (n === 1 ? '1 Tag' : `${n} Tagen`);

function BriefingView({ data }: { data: BriefingData }) {
  const due = data.due_today.length + data.overdue.length;
  return (
    <div className="grid gap-6">
      <p className="text-[15px] leading-relaxed text-fg">{data.summary}</p>
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-2">
        <Section title="Termine heute" count={data.appointments.length} empty="Keine Termine.">
          <ul>
            {data.appointments.map((a, i) => (
              <Row key={i} to={a.url}>
                <span className="mr-2 inline-block w-16 text-muted tabular">{a.time ?? 'ganztägig'}</span>
                <span className="inline-flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--cal-${a.kind})` }} />
                  {a.title}
                </span>
                {a.location && <span className="block pl-[4.5rem] text-xs text-muted">{a.location}</span>}
              </Row>
            ))}
          </ul>
        </Section>

        <Section title="Fällig und überfällig" count={due} empty="Nichts fällig.">
          <ul>
            {data.overdue.map((x, i) => (
              <Row key={`o${i}`} to={x.url} meta={<span className="font-medium text-danger">seit {tage(x.days)}</span>}>
                {x.title}
                {x.customer && <span className="text-muted"> · {x.customer}</span>}
              </Row>
            ))}
            {data.due_today.map((x, i) => (
              <Row key={`d${i}`} to={x.url} meta={<span className="font-medium text-warning">heute</span>}>
                {x.title}
                {x.customer && <span className="text-muted"> · {x.customer}</span>}
              </Row>
            ))}
          </ul>
        </Section>

        <Section title="Warten auf Freigabe" count={data.approvals.length} empty="Keine offenen Freigaben.">
          <ul>
            {data.approvals.map((a, i) => (
              <Row
                key={i}
                to={a.url}
                meta={
                  <span className="flex items-center gap-2">
                    {a.waiting_days <= 0 ? 'seit heute' : `seit ${tage(a.waiting_days)}`}
                    {a.follow_up && <Badge tone="warning">nachfassen</Badge>}
                  </span>
                }
              >
                {a.title}
                <span className="text-muted"> · {a.customer}</span>
              </Row>
            ))}
          </ul>
        </Section>

        <Section title="Drehtage der nächsten 7 Tage" count={data.shoots.length} empty="Keine Drehtage geplant.">
          <ul>
            {data.shoots.map((s, i) => (
              <Row key={i} to={s.url} meta={s.location}>
                <span className="mr-2 text-muted tabular">
                  {formatDate(s.date)}
                  {s.time ? `, ${s.time}` : ''}
                </span>
                {s.title}
                <span className="text-muted"> · {s.customer}</span>
              </Row>
            ))}
          </ul>
        </Section>

        <Section title={`Paketverbrauch ${data.packages[0] ? formatMonth(data.packages[0].month) : ''}`} count={data.packages.length} empty="Keine gebuchten Pakete.">
          <ul className="grid gap-3">
            {data.packages.map((p) => (
              <li key={p.customer_id}>
                <Link to={`/kunden/${p.customer_id}`} className="block rounded hover:bg-surface-2">
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-fg">{p.customer}</span>
                    {p.status === 'rueckstand' && <Badge tone="danger">Rückstand</Badge>}
                    {p.status === 'ueber' && <Badge tone="warning">über Paket</Badge>}
                  </div>
                  {p.items.map((it) => (
                    <div key={it.type} className="flex items-center gap-3 text-xs text-muted">
                      <ProgressBar value={it.used} max={it.quantity} tone={it.used > it.quantity ? 'warning' : it.used === it.quantity ? 'success' : 'accent'} />
                      <span className="w-28 shrink-0 text-right tabular">
                        {it.used} von {it.quantity} × {it.type}
                      </span>
                    </div>
                  ))}
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Warnungen" count={data.warnings.length} empty="Keine Engpässe erkannt.">
          <ul>
            {data.warnings.map((w) => (
              <Row key={w.key} to={w.url}>
                <span className="inline-flex items-baseline gap-2">
                  <span className={cx('size-2 shrink-0 translate-y-[-1px] rounded-full', w.level === 'hoch' ? 'bg-danger' : 'bg-warning')} />
                  {w.text}
                </span>
              </Row>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

export function StartPage() {
  const { data: settings } = useSettings();
  const { data: customers = [] } = useCustomers({});
  const { data: projects = [] } = useProjects({ scope: 'offen' });
  const { data: tasks = [] } = useTasks({ status: 'offen' });
  const { data: briefing, isLoading, error: briefingError, refetch, isFetching } = useBriefingToday();
  const generate = useGenerateBriefing();
  const toast = useToast();
  const navigate = useNavigate();
  const overdueTasks = tasks.filter((t) => t.due_date && t.due_date < today()).length;
  const waiting = projects.filter((p) => p.current_phase === 4 && p.status === 'aktiv').length;
  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
  // Immer der aktuelle Stand; das verschickte Briefing bleibt in den Benachrichtigungen
  const data = briefing?.preview ?? briefing?.briefing?.data ?? null;

  async function run(deliver: boolean) {
    try {
      const b = await generate.mutateAsync(deliver);
      toast.success(b.emailed_at ? 'Briefing erzeugt, Benachrichtigung und E-Mail verschickt' : 'Briefing erzeugt und als Benachrichtigung verschickt');
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <PageHeader
        title={greeting}
        subtitle={formatLongDate()}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/kunden/neu')}>
            Neuer Kunde
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Aktive Kunden" value={customers.filter((c) => c.status === 'aktiv').length} to="/kunden" />
        <Stat label="Laufende Projekte" value={projects.length} to="/projekte" />
        <Stat label="Warten auf Freigabe" value={waiting} to="/projekte" tone={waiting ? 'warning' : undefined} />
        <Stat label={overdueTasks ? `Offene Aufgaben, ${overdueTasks} überfällig` : 'Offene Aufgaben'} value={tasks.length} to="/aufgaben" tone={overdueTasks ? 'danger' : undefined} />
      </div>

      <Card
        title={
          <span>
            Tägliches Briefing
            <span className="ml-2 text-xs font-normal text-muted">
              {briefing?.briefing?.notified_at
                ? `aktueller Stand, verschickt ${formatDateTime(briefing.briefing.notified_at)}`
                : `aktueller Stand, verschickt wird um ${settings?.briefing_time ?? '09:00'} Uhr`}
            </span>
          </span>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} loading={isFetching && !isLoading} onClick={() => void refetch()}>
              Aktualisieren
            </Button>
            <Button size="sm" variant="ghost" icon={<Send className="size-4" />} loading={generate.isPending && generate.variables === true} onClick={() => run(true)}>
              Erzeugen und senden
            </Button>
            <Button size="sm" variant="ghost" icon={<FileText className="size-4" />} onClick={() => window.open('/api/briefing/pdf', '_blank', 'noopener')}>
              PDF
            </Button>
          </>
        }
      >
        {briefingError && !data ? <ErrorBox error={briefingError} /> : isLoading || !data ? <Spinner /> : <BriefingView data={data} />}
      </Card>
    </>
  );
}
