// Projektdetailseite: Phasenleiste, Phasenbereiche, Rechnung, Aufgaben, Verlauf.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CircleCheck, FileText, Lock, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useProject, useTasks } from '../api/projects';
import {
  ApprovalPanel,
  PhaseChecklists,
  PhaseMeta,
  PhaseStepper,
  PublicationsPanel,
  ShootDetails,
  TransitionList,
  useRun,
} from '../components/ProjectPhases';
import { TaskDialog, TaskQuickAdd, TaskRow } from '../components/Tasks';
import { ProjectDrivePanel } from '../components/Drive';
import { AgentPanel } from '../components/AgentPanel';
import { ConfirmDialog, leaveApprovalOptions, useConfirm } from '../components/feedback';
import { PriorityBadge, ProjectStatusBadge } from '../components/labels';
import { Button, Card, ErrorBox, Field, Input, PageHeader, ProgressBar, Segmented, Spinner } from '../components/ui';
import { centsToInput, formatDate, formatEuro, formatMonth, inputToCents } from '../lib/format';
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, PHASE_LABELS, type InvoiceStatus, type Phase, type ProjectDetail, type Task } from '../../../shared/schemas';

function InvoiceCard({ project }: { project: ProjectDetail }) {
  const { run, pending } = useRun();
  const [number, setNumber] = useState(project.invoice_number ?? '');
  const [amount, setAmount] = useState(centsToInput(project.invoice_amount_cents));
  const [error, setError] = useState<string>();
  useEffect(() => {
    setNumber(project.invoice_number ?? '');
    setAmount(centsToInput(project.invoice_amount_cents));
  }, [project.invoice_number, project.invoice_amount_cents]);

  const save = (patch: { invoice_status?: InvoiceStatus; invoice_number?: string; invoice_amount_cents?: number | null }) =>
    run('PUT', `/projects/${project.id}/invoice`, {
      invoice_status: project.invoice_status,
      invoice_number: project.invoice_number,
      invoice_amount_cents: project.invoice_amount_cents,
      invoice_date: project.invoice_date,
      paid_date: project.paid_date,
      ...patch,
    });

  return (
    <Card title="Rechnung">
      <div className="grid gap-3">
        <Segmented<InvoiceStatus>
          value={project.invoice_status}
          onChange={(v) => !pending && save({ invoice_status: v })}
          options={INVOICE_STATUSES.map((s) => ({ value: s, label: INVOICE_STATUS_LABELS[s] }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rechnungsnummer">
            <Input value={number} onChange={(e) => setNumber(e.target.value)} onBlur={() => number !== (project.invoice_number ?? '') && save({ invoice_number: number })} />
          </Field>
          <Field label="Betrag (EUR)" error={error}>
            <Input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              invalid={!!error}
              onBlur={() => {
                const cents = inputToCents(amount);
                if (Number.isNaN(cents)) return setError('Ungültiger Betrag');
                setError(undefined);
                if (cents !== project.invoice_amount_cents) save({ invoice_amount_cents: cents });
              }}
            />
          </Field>
        </div>
        {(project.invoice_date || project.paid_date) && (
          <p className="text-xs text-muted">
            {project.invoice_date && `Gestellt am ${formatDate(project.invoice_date)}`}
            {project.paid_date && ` · bezahlt am ${formatDate(project.paid_date)}`}
          </p>
        )}
      </div>
    </Card>
  );
}

function ProjectTasks({ project }: { project: ProjectDetail }) {
  const { data = [] } = useTasks({ project_id: project.id });
  const [editing, setEditing] = useState<Task | null>(null);
  return (
    <Card title={`Aufgaben${data.length ? ` (${data.length})` : ''}`}>
      {data.length > 0 && (
        <ul className="-mt-2.5 mb-3 divide-y divide-line">
          {data.map((t) => (
            <TaskRow key={t.id} task={t} onEdit={setEditing} showLinks={false} />
          ))}
        </ul>
      )}
      <TaskQuickAdd projectId={project.id} customerId={project.customer_id} phase={project.current_phase} />
      <TaskDialog open={!!editing} task={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

export function ProjectDetailPage() {
  const id = Number(useParams().id);
  const { data: project, isLoading, error } = useProject(id);
  const [selected, setSelected] = useState<Phase | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { run, pending } = useRun();
  const navigate = useNavigate();
  const confirm = useConfirm();

  // Beim Phasenwechsel die neue Phase anzeigen
  const current = project?.current_phase;
  useEffect(() => setSelected(null), [current]);

  if (isLoading) return <Spinner />;
  if (error || !project) return <ErrorBox error={error || new Error('Projekt nicht gefunden')} />;

  const phase = selected ?? project.current_phase;
  const active = project.status === 'aktiv' || project.status === 'pausiert';
  const next = project.current_phase < 5 ? ((project.current_phase + 1) as Phase) : null;
  const prev = project.current_phase > 1 ? ((project.current_phase - 1) as Phase) : null;
  const openGate = project.checklist.find((i) => i.phase === project.current_phase && i.is_gate && !i.is_done);
  const moveTo = async (to: Phase, message: string) => {
    if (project.current_phase === 4 && !(await confirm(leaveApprovalOptions(to)))) return;
    run('POST', `/projects/${id}/move`, { to_phase: to }, message);
  };

  return (
    <>
      <PageHeader
        back={
          <Link to="/projekte" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
            <ArrowLeft className="size-3.5" />
            Projekte
          </Link>
        }
        title={project.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <ProjectStatusBadge status={project.status} />
            <PriorityBadge priority={project.priority} />
            <Link to={`/kunden/${project.customer_id}`} className="text-accent hover:underline">
              {project.customer_name}
            </Link>
            <span>
              {project.deliverable_type_name ? `${project.deliverable_count} × ${project.deliverable_type_name} · ` : ''}
              {formatMonth(project.service_month)}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
              Löschen
            </Button>
            <Button icon={<Pencil className="size-4" />} onClick={() => navigate(`/projekte/${id}/bearbeiten`)}>
              Bearbeiten
            </Button>
            {project.status === 'abgeschlossen' || project.status === 'abgebrochen' ? (
              <Button variant="primary" icon={<RotateCcw className="size-4" />} loading={pending} onClick={() => run('POST', `/projects/${id}/reopen`, undefined, 'Projekt wieder geöffnet')}>
                Wieder öffnen
              </Button>
            ) : project.current_phase === 5 ? (
              <Button variant="primary" icon={<CircleCheck className="size-4" />} loading={pending} onClick={() => run('POST', `/projects/${id}/complete`, undefined, 'Projekt abgeschlossen')}>
                Abschließen
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="mb-5">
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex min-w-48 flex-1 items-center gap-3">
            <ProgressBar value={project.progress} max={100} tone={project.progress === 100 ? 'success' : project.overdue ? 'danger' : 'accent'} />
            <span className="text-sm font-semibold whitespace-nowrap tabular">{project.progress} %</span>
          </div>
          {active && project.days_in_phase !== null && (
            <span className="text-[13px] text-muted">
              {project.days_in_phase === 0 ? 'Seit heute' : project.days_in_phase === 1 ? 'Seit 1 Tag' : `Seit ${project.days_in_phase} Tagen`} in{' '}
              {PHASE_LABELS[project.current_phase]}
            </span>
          )}
          {active && (
            <div className="flex gap-2">
              {prev && (
                <Button size="sm" icon={<ArrowLeft className="size-4" />} loading={pending} onClick={() => moveTo(prev, `Zurück in ${PHASE_LABELS[prev]}`)}>
                  Zurück
                </Button>
              )}
              {next && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!!openGate}
                  title={openGate ? `Erst „${openGate.label}“ abhaken` : undefined}
                  loading={pending}
                  onClick={() => moveTo(next, `Weiter in ${PHASE_LABELS[next]}`)}
                >
                  Weiter zu {PHASE_LABELS[next]}
                  <ArrowRight className="size-4" />
                </Button>
              )}
            </div>
          )}
        </div>
        {openGate && active && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-warning">
            <Lock className="size-4 shrink-0" />„{openGate.label}“ muss abgehakt sein, bevor das Projekt weiterrücken kann.
          </div>
        )}
        <PhaseStepper project={project} selected={phase} onSelect={setSelected} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-5 lg:col-span-2">
          <Card title={`${phase} · ${PHASE_LABELS[phase]}${phase === project.current_phase && active ? ' (aktuelle Phase)' : ''}`}>
            <div className="grid gap-6">
              <PhaseMeta key={`meta-${phase}`} project={project} phase={phase} />
              {phase === 1 && <ShootDetails project={project} />}
              {(phase === 2 || phase === 3) && <AgentPanel project={project} />}
              {phase === 3 && <ProjectDrivePanel projectId={project.id} customerId={project.customer_id} />}
              {phase === 4 && <ApprovalPanel project={project} />}
              {phase === 5 && <PublicationsPanel project={project} />}
              <PhaseChecklists project={project} phase={phase} />
            </div>
          </Card>
          {project.description && (
            <Card title="Beschreibung">
              <p className="text-sm whitespace-pre-wrap">{project.description}</p>
            </Card>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-5">
          <ProjectTasks project={project} />
          <InvoiceCard project={project} />
          <Card title="Dokumente">
            <ul className="grid gap-1.5 text-sm">
              {[
                ['Drehplan', `/api/projects/${project.id}/drehplan.pdf`, 'Termin, Ort, Ansprechpartner, Shotlist und Equipment'],
                ['Freigabe-Protokoll', `/api/projects/${project.id}/freigabe.pdf`, 'Freigaberunden, Feedback, Endkontrolle, Veröffentlichungen'],
              ].map(([label, href, hint]) => (
                <li key={label}>
                  <a href={href} target="_blank" rel="noreferrer" className="group flex items-start gap-2.5 rounded px-1 py-1 hover:bg-surface-2">
                    <FileText className="mt-0.5 size-4 shrink-0 text-subtle group-hover:text-accent" />
                    <span>
                      <span className="text-fg group-hover:text-accent">{label} (PDF)</span>
                      <span className="block text-xs text-muted">{hint}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Vorlage</dt>
              <dd>{project.template_name ?? '–'}</dd>
              <dt className="text-muted">Leistungsmonat</dt>
              <dd>{formatMonth(project.service_month)}</dd>
              <dt className="text-muted">Erinnerung</dt>
              <dd>nach {project.effective_reminder_days} Tagen ohne Freigabe</dd>
              <dt className="text-muted">Angelegt</dt>
              <dd>{formatDate(project.created_at)}</dd>
              {project.completed_at && (
                <>
                  <dt className="text-muted">Abgeschlossen</dt>
                  <dd>{formatDate(project.completed_at)}</dd>
                </>
              )}
              {project.invoice_amount_cents !== null && (
                <>
                  <dt className="text-muted">Betrag</dt>
                  <dd>{formatEuro(project.invoice_amount_cents)}</dd>
                </>
              )}
            </dl>
            {project.notes && <p className="mt-3 border-t border-line pt-3 text-sm whitespace-pre-wrap">{project.notes}</p>}
          </Card>
          <Card title="Verlauf">
            <TransitionList project={project} />
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        danger
        title="Projekt löschen?"
        text={
          <>
            <strong className="text-fg">{project.title}</strong> wird mit Checklisten, Freigaberunden, Veröffentlichungen und
            zugehörigen Aufgaben endgültig gelöscht. Wenn das Projekt nur nicht stattfindet, setze den Status besser auf
            „Abgebrochen“.
          </>
        }
        confirmLabel="Endgültig löschen"
        loading={pending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (await run('DELETE', `/projects/${id}`, undefined, 'Projekt gelöscht')) navigate('/projekte', { replace: true });
        }}
      />
    </>
  );
}
