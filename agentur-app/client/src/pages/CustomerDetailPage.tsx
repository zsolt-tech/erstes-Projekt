// Kundendetailseite: Stammdaten, Ansprechpartner, Kanäle, Paketverbrauch.
// Projekte, Aufgaben, Termine und Drive-Links folgen in den nächsten Etappen.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, FileText, Globe, Mail, MapPin, Pencil, Phone, Plus } from 'lucide-react';
import { useArchiveCustomer, useCustomer } from '../api/hooks';
import { Badge, Button, Card, ErrorBox, IconButton, PageHeader, ProgressBar, Segmented, Spinner, type Tone } from '../components/ui';
import { useProjects, useTasks } from '../api/projects';
import { ProjectTable } from './ProjectsPage';
import { TaskDialog, TaskQuickAdd, TaskRow } from '../components/Tasks';
import { CustomerDriveCard } from '../components/Drive';
import { useCalendarItems } from '../api/calendar';
import { ConfirmDialog, useToast } from '../components/feedback';
import { CustomerStatusBadge } from '../components/labels';
import { currentMonth, displayUrl, formatDate, formatEuro, formatMonth, shiftMonth, telHref, today } from '../lib/format';
import { CALENDAR_KIND_LABELS, CUSTOMER_TYPE_LABELS, PLATFORM_LABELS, QA_PROFILE_BY_TYPE, QA_PROFILE_LABELS, type PackageUsage, type Task } from '../../../shared/schemas';

function UsageRow({ item }: { item: PackageUsage }) {
  const over = item.used > item.quantity;
  const full = item.used === item.quantity;
  const tone: Tone = over ? 'warning' : full ? 'success' : 'accent';
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-fg">{item.deliverable_type_name}</span>
        <span className="tabular text-muted">
          <span className="font-semibold text-fg">{item.used}</span> von {item.quantity}
          {item.completed > 0 && <> · {item.completed} abgeschlossen</>}
        </span>
      </div>
      <ProgressBar value={item.used} max={item.quantity} tone={tone} />
      {over && <p className="mt-1 text-xs text-warning">{item.used - item.quantity} über dem gebuchten Paket</p>}
    </div>
  );
}

function CustomerProjects({ customerId, archived }: { customerId: number; archived: boolean }) {
  const [scope, setScope] = useState<'offen' | 'alle'>('offen');
  const { data = [], isLoading } = useProjects({ customer_id: customerId, scope });
  const navigate = useNavigate();
  return (
    <Card
      title="Projekte"
      padded={false}
      actions={
        <>
          <Segmented
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'offen', label: 'Laufend' },
              { value: 'alle', label: 'Alle' },
            ]}
          />
          {!archived && (
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => navigate(`/projekte/neu?kunde=${customerId}`)}>
              Neues Projekt
            </Button>
          )}
        </>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : data.length === 0 ? (
        <p className="px-4 py-4 text-sm text-subtle">{scope === 'offen' ? 'Keine laufenden Projekte.' : 'Noch keine Projekte.'}</p>
      ) : (
        <ProjectTable projects={data} showCustomer={false} />
      )}
    </Card>
  );
}

function CustomerTasks({ customerId }: { customerId: number }) {
  const { data = [] } = useTasks({ customer_id: customerId });
  const [editing, setEditing] = useState<Task | null>(null);
  return (
    <Card title={`Offene Aufgaben${data.length ? ` (${data.length})` : ''}`}>
      {data.length > 0 && (
        <ul className="-mt-2.5 mb-3 divide-y divide-line">
          {data.map((t) => (
            <TaskRow key={t.id} task={t} onEdit={setEditing} />
          ))}
        </ul>
      )}
      <TaskQuickAdd customerId={customerId} />
      <TaskDialog open={!!editing} task={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function CustomerAppointments({ customerId }: { customerId: number }) {
  const start = today();
  const end = (() => {
    const d = new Date(`${start}T12:00:00`);
    d.setDate(d.getDate() + 60);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const { data = [], isLoading } = useCalendarItems({ start, end }, customerId);
  return (
    <Card title="Termine der nächsten 60 Tage">
      {isLoading ? (
        <Spinner />
      ) : data.length === 0 ? (
        <p className="text-sm text-subtle">Keine anstehenden Termine.</p>
      ) : (
        <ul className="-my-1 divide-y divide-line text-sm">
          {data.map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--cal-${i.kind})` }} title={CALENDAR_KIND_LABELS[i.kind]} />
              <span className="w-32 shrink-0 text-muted tabular">
                {formatDate(i.start.slice(0, 10))}
                {!i.all_day && `, ${i.start.slice(11, 16)}`}
              </span>
              {i.url ? (
                <Link to={i.url} className="min-w-0 flex-1 truncate text-fg hover:text-accent">
                  {i.title}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function CustomerDetailPage() {
  const id = Number(useParams().id);
  const [month, setMonth] = useState(currentMonth());
  const { data: c, isLoading, error } = useCustomer(id, month);
  const archive = useArchiveCustomer();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (isLoading) return <Spinner />;
  if (error || !c) return <ErrorBox error={error || new Error('Kunde nicht gefunden')} />;

  const address = [c.street, [c.postal_code, c.city].filter(Boolean).join(' '), c.country !== 'Deutschland' ? c.country : null]
    .filter(Boolean)
    .join(', ');

  async function toggleArchive() {
    try {
      await archive.mutateAsync({ id, archived: !c!.archived_at });
      toast.success(c!.archived_at ? 'Kunde wiederhergestellt' : 'Kunde archiviert');
      setConfirmArchive(false);
    } catch (err) {
      toast.error(err);
    }
  }

  const activePackage = c.package_items.filter((p) => {
    const t = today();
    return p.valid_from <= t && (!p.valid_until || p.valid_until >= t);
  });
  const monthlyTotal = activePackage.reduce((sum, p) => sum + (p.monthly_price_cents ?? 0), 0);

  return (
    <>
      <PageHeader
        back={
          <Link to="/kunden" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
            <ArrowLeft className="size-3.5" />
            Kunden
          </Link>
        }
        title={c.company_name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <CustomerStatusBadge status={c.status} stage={c.pipeline_stage} />
            {c.archived_at && <Badge tone="danger">Archiviert</Badge>}
            <span>{[c.industry, CUSTOMER_TYPE_LABELS[c.customer_type]].filter(Boolean).join(' · ')}</span>
          </span>
        }
        actions={
          <>
            <Button
              icon={c.archived_at ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
              onClick={() => (c.archived_at ? toggleArchive() : setConfirmArchive(true))}
              loading={archive.isPending}
            >
              {c.archived_at ? 'Wiederherstellen' : 'Archivieren'}
            </Button>
            <Button variant="primary" icon={<Pencil className="size-4" />} onClick={() => navigate(`/kunden/${id}/bearbeiten`)}>
              Bearbeiten
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-5 lg:col-span-2">
          <Card
            title={`Paketverbrauch ${formatMonth(month)}`}
            actions={
              <>
                <a
                  href={`/api/customers/${id}/report.pdf?month=${month}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-fg"
                  title={`Monatsbericht ${formatMonth(month)} als PDF`}
                >
                  <FileText className="size-4" />
                  Monatsbericht
                </a>
                <IconButton label="Vormonat" onClick={() => setMonth(shiftMonth(month, -1))}>
                  <ChevronLeft className="size-4" />
                </IconButton>
                {month !== currentMonth() && (
                  <Button size="sm" variant="ghost" onClick={() => setMonth(currentMonth())}>
                    Aktuell
                  </Button>
                )}
                <IconButton label="Folgemonat" onClick={() => setMonth(shiftMonth(month, 1))}>
                  <ChevronRight className="size-4" />
                </IconButton>
              </>
            }
          >
            {c.package_usage.items.length === 0 ? (
              <p className="text-sm text-muted">
                Für diesen Monat ist kein Paket gebucht.{' '}
                <Link to={`/kunden/${id}/bearbeiten`} className="text-accent hover:underline">
                  Paket hinterlegen
                </Link>
              </p>
            ) : (
              <div className="grid gap-4">
                {c.package_usage.items.map((item) => (
                  <UsageRow key={item.deliverable_type_id} item={item} />
                ))}
                <p className="text-xs text-subtle">
                  Gezählt werden alle Projekte mit diesem Leistungsmonat, die nicht abgebrochen sind. „Abgeschlossen“ heißt
                  veröffentlicht.
                </p>
              </div>
            )}
          </Card>

          <CustomerProjects customerId={id} archived={!!c.archived_at} />
          <CustomerTasks customerId={id} />
          <CustomerAppointments customerId={id} />

          <Card title="Notizen">
            {c.notes ? (
              <p className="text-sm whitespace-pre-wrap text-fg">{c.notes}</p>
            ) : (
              <p className="text-sm text-subtle">Keine Notizen.</p>
            )}
          </Card>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-5">
          <Card title="Kontaktdaten">
            <dl className="grid gap-3 text-sm">
              <div className="flex gap-2.5">
                <MapPin className="mt-0.5 size-4 shrink-0 text-subtle" />
                <span className={address ? 'text-fg' : 'text-subtle'}>{address || 'Keine Adresse'}</span>
              </div>
              <div className="flex gap-2.5">
                <Globe className="mt-0.5 size-4 shrink-0 text-subtle" />
                {c.website ? (
                  <a href={c.website} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
                    {displayUrl(c.website)}
                  </a>
                ) : (
                  <span className="text-subtle">Keine Website</span>
                )}
              </div>
            </dl>
          </Card>

          <Card title="Ansprechpartner">
            {c.contacts.length === 0 ? (
              <p className="text-sm text-subtle">Kein Ansprechpartner erfasst.</p>
            ) : (
              <ul className="grid gap-4">
                {c.contacts.map((p) => (
                  <li key={p.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-fg">{p.name}</span>
                      {p.is_primary ? <Badge tone="accent">Hauptkontakt</Badge> : null}
                    </div>
                    {p.role && <div className="text-xs text-muted">{p.role}</div>}
                    <div className="mt-1 grid gap-0.5">
                      {p.phone && (
                        <a href={telHref(p.phone)} className="inline-flex items-center gap-1.5 text-muted hover:text-accent">
                          <Phone className="size-3.5" />
                          <span className="tabular">{p.phone}</span>
                        </a>
                      )}
                      {p.email && (
                        <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1.5 break-all text-muted hover:text-accent">
                          <Mail className="size-3.5 shrink-0" />
                          {p.email}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Videoschnitt">
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Prüfprofil</dt>
                <dd className="text-right text-fg">
                  {QA_PROFILE_LABELS[c.qa_profile ?? QA_PROFILE_BY_TYPE[c.customer_type]]}
                  {!c.qa_profile && <span className="block text-xs text-subtle">aus dem Kundentyp</span>}
                </dd>
              </div>
              {!!c.qa_motion_required && <div className="text-muted">Durchgehende Kamerabewegung Pflicht</div>}
              {c.qa_notes ? <p className="whitespace-pre-wrap text-fg">{c.qa_notes}</p> : <p className="text-subtle">Keine besonderen Hinweise.</p>}
            </dl>
          </Card>

          <Card title="Social Media">
            {c.social_channels.length === 0 ? (
              <p className="text-sm text-subtle">Keine Kanäle erfasst.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {c.social_channels.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3">
                    <span className="text-muted">{PLATFORM_LABELS[s.platform]}</span>
                    {s.url ? (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-w-0 items-center gap-1 text-accent hover:underline"
                      >
                        <span className="truncate">{s.handle || displayUrl(s.url)}</span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="truncate text-fg">{s.handle}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Gebuchtes Paket">
            {c.package_items.length === 0 ? (
              <p className="text-sm text-subtle">Kein Paket gebucht.</p>
            ) : (
              <ul className="grid gap-2.5 text-sm">
                {c.package_items.map((p) => {
                  const t = today();
                  const active = p.valid_from <= t && (!p.valid_until || p.valid_until >= t);
                  return (
                    <li key={p.id} className={active ? '' : 'opacity-60'}>
                      <div className="flex justify-between gap-3">
                        <span className="text-fg">
                          {p.quantity_per_month} × {p.deliverable_type_name} pro Monat
                        </span>
                        {p.monthly_price_cents !== null && (
                          <span className="tabular text-muted">{formatEuro(p.monthly_price_cents)}</span>
                        )}
                      </div>
                      <div className="text-xs text-subtle">
                        ab {formatDate(p.valid_from)}
                        {p.valid_until ? ` bis ${formatDate(p.valid_until)}` : ''}
                        {!active && ' (nicht aktiv)'}
                      </div>
                    </li>
                  );
                })}
                {monthlyTotal > 0 && (
                  <li className="mt-1 flex justify-between border-t border-line pt-2.5 font-medium">
                    <span>Summe aktiv</span>
                    <span className="tabular">{formatEuro(monthlyTotal)}</span>
                  </li>
                )}
              </ul>
            )}
          </Card>

          <CustomerDriveCard customerId={id} isLead={c.status === 'interessent'} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title="Kunden archivieren?"
        text={
          <>
            <strong className="text-fg">{c.company_name}</strong> wird aus der Kundenliste ausgeblendet. Alle Daten bleiben
            erhalten und der Kunde kann jederzeit über „Archiv anzeigen“ wiederhergestellt werden.
          </>
        }
        confirmLabel="Archivieren"
        onConfirm={toggleArchive}
        onCancel={() => setConfirmArchive(false)}
        loading={archive.isPending}
      />
    </>
  );
}
