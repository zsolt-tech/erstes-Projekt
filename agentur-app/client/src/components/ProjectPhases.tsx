// Bausteine der Projektdetailseite: Phasenleiste, Checklisten, Drehtag, Freigabe, Veröffentlichungen.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Clock, ExternalLink, Lock, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useProjectAction } from '../api/projects';
import { useTeam } from '../api/hooks';
import { Dialog, useToast } from './feedback';
import { Badge, Button, Field, IconButton, Input, Select, Textarea, cx } from './ui';
import { displayUrl, formatDate, formatDateTime, today } from '../lib/format';
import {
  CHECKLIST_KIND_LABELS,
  PHASES,
  PHASE_LABELS,
  PLATFORMS,
  PLATFORM_LABELS,
  type ChecklistItem,
  type ChecklistKind,
  type Phase,
  type Platform,
  type ProjectDetail,
  type Publication,
} from '../../../shared/schemas';

/** Gemeinsame Ausführung von Projektaktionen mit Fehlermeldung */
export function useRun() {
  const action = useProjectAction();
  const toast = useToast();
  return {
    pending: action.isPending,
    async run(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, success?: string) {
      try {
        const result = await action.mutateAsync({ method, url, body });
        if (success) toast.success(success);
        return result ?? true;
      } catch (err) {
        toast.error(err);
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------
// Phasenleiste
// ---------------------------------------------------------------------

export function PhaseStepper({ project, selected, onSelect }: { project: ProjectDetail; selected: Phase; onSelect: (p: Phase) => void }) {
  const done = project.status === 'abgeschlossen';
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Phasen">
      {PHASES.map((phase) => {
        const isCurrent = !done && project.current_phase === phase;
        const isDone = done || phase < project.current_phase;
        const items = project.checklist.filter((i) => i.phase === phase);
        const doneCount = items.filter((i) => i.is_done).length;
        return (
          <li key={phase}>
            <button
              type="button"
              onClick={() => onSelect(phase)}
              aria-current={isCurrent ? 'step' : undefined}
              className={cx(
                'flex w-full flex-col items-start gap-1 rounded-md border px-2.5 py-2 text-left transition-colors',
                selected === phase ? 'ring-2 ring-accent/40' : '',
                isCurrent
                  ? 'border-accent bg-accent-soft'
                  : isDone
                    ? 'border-line bg-surface hover:bg-surface-2'
                    : 'border-dashed border-line-strong bg-surface hover:bg-surface-2',
              )}
            >
              <span className="flex w-full items-center gap-1.5">
                <span
                  className={cx(
                    'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                    isDone ? 'bg-success text-white' : isCurrent ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-muted',
                  )}
                >
                  {isDone ? <Check className="size-3" /> : phase}
                </span>
                <span className={cx('truncate text-[13px] font-medium', isCurrent ? 'text-accent' : isDone ? 'text-fg' : 'text-muted')}>
                  {PHASE_LABELS[phase]}
                </span>
              </span>
              <span className="hidden text-[11px] text-subtle tabular sm:block">
                {items.length ? `${doneCount}/${items.length} erledigt` : 'keine Punkte'}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------
// Checklisten
// ---------------------------------------------------------------------

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const { run } = useRun();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(item.label);
  useEffect(() => setLabel(item.label), [item.label]);

  return (
    <li className="group flex items-start gap-2.5 py-1.5">
      <input
        type="checkbox"
        checked={!!item.is_done}
        onChange={() => run('PATCH', `/checklist/${item.id}`, { is_done: !item.is_done })}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
        aria-label={item.label}
      />
      {editing ? (
        <form
          className="flex flex-1 items-center gap-1"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run('PATCH', `/checklist/${item.id}`, { label })) setEditing(false);
          }}
        >
          <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-7" autoFocus aria-label="Bezeichnung" />
          <IconButton label="Übernehmen" type="submit">
            <Check className="size-4" />
          </IconButton>
          <IconButton label="Abbrechen" onClick={() => (setLabel(item.label), setEditing(false))}>
            <X className="size-4" />
          </IconButton>
        </form>
      ) : (
        <>
          <span className={cx('flex-1 text-sm', item.is_done ? 'text-subtle line-through' : 'text-fg')}>
            {item.label}
            {item.is_gate ? (
              <span className="ml-2 inline-flex items-center gap-1 align-middle">
                <Badge tone={item.is_done ? 'success' : 'warning'}>
                  <Lock className="mr-1 size-3" />
                  Pflicht vor dem Weiterrücken
                </Badge>
              </span>
            ) : null}
            {item.auto_key === 'final_files_present' && !item.is_done ? (
              <span className="ml-2 text-xs text-subtle">wird ab Etappe 3 automatisch aus Drive erkannt</span>
            ) : null}
          </span>
          {!item.is_system && (
            <span className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <IconButton label="Umbenennen" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
              </IconButton>
              <IconButton label="Punkt löschen" onClick={() => run('DELETE', `/checklist/${item.id}`)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </span>
          )}
        </>
      )}
    </li>
  );
}

function AddChecklistItem({ projectId, phase, kind }: { projectId: number; phase: Phase; kind: ChecklistKind }) {
  const { run, pending } = useRun();
  const [label, setLabel] = useState('');
  const placeholder = kind === 'equipment' ? 'Equipment ergänzen' : kind === 'shot' ? 'Einstellung ergänzen' : 'Punkt ergänzen';
  return (
    <form
      className="mt-1 flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!label.trim()) return;
        if (await run('POST', `/projects/${projectId}/checklist`, { phase, kind, label })) setLabel('');
      }}
    >
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={placeholder} className="h-8" aria-label={placeholder} />
      <Button size="sm" type="submit" icon={<Plus className="size-4" />} disabled={!label.trim() || pending}>
        Hinzufügen
      </Button>
    </form>
  );
}

export function PhaseChecklists({ project, phase }: { project: ProjectDetail; phase: Phase }) {
  const items = project.checklist.filter((i) => i.phase === phase);
  const kinds: ChecklistKind[] = phase === 1 ? ['standard', 'equipment', 'shot'] : ['standard'];
  return (
    <div className="grid gap-5">
      {kinds.map((kind) => {
        const list = items.filter((i) => i.kind === kind);
        const done = list.filter((i) => i.is_done).length;
        return (
          <section key={kind}>
            <h3 className="mb-1 flex items-center justify-between text-[13px] font-semibold text-fg">
              {CHECKLIST_KIND_LABELS[kind]}
              <span className="text-xs font-normal text-muted tabular">
                {done} von {list.length}
              </span>
            </h3>
            {list.length > 0 && (
              <ul className="divide-y divide-line">
                {list.map((item) => (
                  <ChecklistRow key={item.id} item={item} />
                ))}
              </ul>
            )}
            <AddChecklistItem projectId={project.id} phase={phase} kind={kind} />
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// Fälligkeit, Verantwortlicher, Notizen je Phase
// ---------------------------------------------------------------------

export function PhaseMeta({ project, phase }: { project: ProjectDetail; phase: Phase }) {
  const { run } = useRun();
  const { data: team = [] } = useTeam();
  const data = project.phases.find((p) => p.phase === phase)!;
  const [notes, setNotes] = useState(data.notes ?? '');
  useEffect(() => setNotes(data.notes ?? ''), [data.notes]);

  const save = (patch: Partial<{ due_date: string | null; assignee_id: number | null; notes: string }>) =>
    run('PUT', `/projects/${project.id}/phases/${phase}`, {
      due_date: data.due_date,
      assignee_id: data.assignee_id,
      notes: data.notes,
      ...patch,
    });

  const overdue = data.due_date && !data.completed_at && data.due_date < today() && project.status === 'aktiv';
  const activeTeam = team.filter((m) => m.active || m.id === data.assignee_id);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Fällig am" error={overdue ? 'Überfällig' : undefined}>
        <Input
          type="date"
          value={data.due_date ?? ''}
          onChange={(e) => save({ due_date: e.target.value || null })}
          invalid={!!overdue}
          disabled={phase === 1}
        />
      </Field>
      {phase === 1 ? (
        <p className="self-end pb-2 text-xs text-subtle">Die Fälligkeit des Drehtags folgt dem Drehdatum.</p>
      ) : activeTeam.length > 0 ? (
        <Field label="Verantwortlich">
          <Select value={data.assignee_id ?? ''} onChange={(e) => save({ assignee_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Ich selbst</option>
            {activeTeam.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <div />
      )}
      <Field label="Notizen zur Phase" className="sm:col-span-2">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (data.notes ?? '') && save({ notes })}
          rows={2}
          placeholder="Wird beim Verlassen des Feldes gespeichert"
        />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------
// Drehtag
// ---------------------------------------------------------------------

export function ShootDetails({ project }: { project: ProjectDetail }) {
  const { run, pending } = useRun();
  const [form, setForm] = useState(project.shoot);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setForm(project.shoot);
  }, [project.shoot, dirty]);
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run('PUT', `/projects/${project.id}/shoot`, form, 'Drehtag gespeichert')) setDirty(false);
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-4">
      <Field label="Datum">
        <Input type="date" value={form.shoot_date ?? ''} onChange={(e) => set('shoot_date', e.target.value)} />
      </Field>
      <Field label="Von">
        <Input type="time" value={form.start_time ?? ''} onChange={(e) => set('start_time', e.target.value)} />
      </Field>
      <Field label="Bis">
        <Input type="time" value={form.end_time ?? ''} onChange={(e) => set('end_time', e.target.value)} />
      </Field>
      <div />
      <Field label="Ort" className="sm:col-span-2">
        <Input value={form.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder="Adresse oder Treffpunkt" />
      </Field>
      <Field label="Hinweise vor Ort" className="sm:col-span-2">
        <Input value={form.location_notes ?? ''} onChange={(e) => set('location_notes', e.target.value)} placeholder="Parken, Ansprechpartner, Zugang" />
      </Field>
      <Field label="Shotlist-Notizen" hint="Ergänzend zu den Einstellungen in der Shotlist unten" className="sm:col-span-4">
        <Textarea value={form.shotlist_notes ?? ''} onChange={(e) => set('shotlist_notes', e.target.value)} rows={3} />
      </Field>
      <div className="flex items-center justify-between gap-3 sm:col-span-4">
        <p className="text-xs text-subtle">Ab Etappe 4 wird der Drehtag automatisch in Google Calendar eingetragen.</p>
        <Button type="submit" variant={dirty ? 'primary' : 'secondary'} loading={pending} disabled={!dirty}>
          Drehtag speichern
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------
// Freigabe
// ---------------------------------------------------------------------

export function ApprovalPanel({ project }: { project: ProjectDetail }) {
  const { run, pending } = useRun();
  const open = project.approval_rounds.find((r) => !r.responded_at);
  const [correction, setCorrection] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [backToEditing, setBackToEditing] = useState(true);
  const waiting = project.approval_waiting_days;
  const threshold = project.effective_reminder_days;

  async function decide(result: 'freigegeben' | 'korrektur') {
    const ok = await run(
      'POST',
      `/projects/${project.id}/approval`,
      { result, feedback: result === 'korrektur' ? feedback : null, back_to_editing: backToEditing },
      result === 'freigegeben' ? 'Freigabe erfasst, weiter mit der Veröffentlichung' : 'Korrekturschleife erfasst',
    );
    if (ok) {
      setCorrection(false);
      setFeedback('');
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Korrekturschleifen" value={project.correction_count} />
        <Stat label="Freigaberunden" value={project.approval_rounds.length} />
        <Stat
          label="Wartet seit"
          value={open && waiting !== null ? (waiting === 1 ? '1 Tag' : `${waiting} Tagen`) : '–'}
          tone={open && waiting !== null && waiting >= threshold ? 'danger' : undefined}
        />
      </div>

      {open && project.current_phase === 4 && project.status === 'aktiv' ? (
        <div className="rounded-md border border-violet/30 bg-violet-soft/50 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-fg">Runde {open.round_no} wartet auf Rückmeldung</div>
              <div className="mt-0.5 text-xs text-muted">
                Erinnerung nach {threshold} {threshold === 1 ? 'Tag' : 'Tagen'} ohne Antwort (ab Etappe 5 automatisch)
              </div>
            </div>
            <Field label="Anfrage gesendet am">
              <Input
                type="date"
                value={open.requested_at.slice(0, 10)}
                onChange={(e) => e.target.value && run('PUT', `/projects/${project.id}/approval`, { requested_date: e.target.value })}
                className="w-44"
              />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" icon={<Check className="size-4" />} onClick={() => decide('freigegeben')} loading={pending}>
              Kunde hat freigegeben
            </Button>
            <Button icon={<RotateCcw className="size-4" />} onClick={() => setCorrection(true)}>
              Korrektur nötig
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {project.current_phase < 4
            ? 'Sobald das Projekt in die Phase Freigabe rückt, startet automatisch eine Freigaberunde mit dem heutigen Datum.'
            : 'Keine offene Freigabeanfrage.'}
        </p>
      )}

      {project.approval_rounds.length > 0 && (
        <div>
          <h3 className="mb-1 text-[13px] font-semibold text-fg">Verlauf</h3>
          <ul className="divide-y divide-line text-sm">
            {project.approval_rounds.map((r) => (
              <li key={r.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Runde {r.round_no}</span>
                  {r.result === 'freigegeben' && <Badge tone="success">Freigegeben</Badge>}
                  {r.result === 'korrektur' && <Badge tone="warning">Korrektur</Badge>}
                  {!r.result && <Badge tone="violet">Offen</Badge>}
                  <span className="text-xs text-muted">
                    angefragt {formatDate(r.requested_at)}
                    {r.responded_at ? `, Antwort ${formatDate(r.responded_at)}` : ''}
                  </span>
                </div>
                {r.feedback && <p className="mt-1 text-sm whitespace-pre-wrap text-muted">{r.feedback}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog
        open={correction}
        onClose={() => setCorrection(false)}
        title="Korrektur erfassen"
        footer={
          <>
            <Button onClick={() => setCorrection(false)}>Abbrechen</Button>
            <Button variant="primary" onClick={() => decide('korrektur')} loading={pending}>
              Korrektur speichern
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Rückmeldung des Kunden">
            <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4} placeholder="Was soll geändert werden?" autoFocus />
          </Field>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="checkbox" checked={backToEditing} onChange={(e) => setBackToEditing(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>
              Zurück in die Bearbeitung
              <span className="block text-xs text-muted">
                Die Clip-Qualitätsprüfung wird zurückgesetzt und muss für die neue Fassung erneut abgehakt werden. Ohne Haken
                bleibt das Projekt in der Freigabe und eine neue Runde startet sofort.
              </span>
            </span>
          </label>
        </div>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'danger' }) {
  return (
    <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx('text-lg font-semibold tabular', tone === 'danger' ? 'text-danger' : 'text-fg')}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Veröffentlichungen
// ---------------------------------------------------------------------

function PublicationRow({ pub }: { pub: Publication }) {
  const { run } = useRun();
  const [url, setUrl] = useState(pub.post_url ?? '');
  useEffect(() => setUrl(pub.post_url ?? ''), [pub.post_url]);
  const save = (patch: Partial<Publication>) =>
    run('PUT', `/publications/${pub.id}`, {
      platform: pub.platform,
      planned_date: pub.planned_date,
      planned_time: pub.planned_time,
      caption: pub.caption,
      post_url: pub.post_url,
      ...patch,
    });

  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[150px_150px_100px_1fr_auto] sm:items-center">
      <Select value={pub.platform} onChange={(e) => save({ platform: e.target.value as Platform })} aria-label="Plattform">
        {PLATFORMS.map((p) => (
          <option key={p} value={p}>
            {PLATFORM_LABELS[p]}
          </option>
        ))}
      </Select>
      <Input type="date" value={pub.planned_date ?? ''} onChange={(e) => save({ planned_date: e.target.value || null })} aria-label="Geplant am" />
      <Input type="time" value={pub.planned_time ?? ''} onChange={(e) => save({ planned_time: e.target.value || null })} aria-label="Uhrzeit" />
      <div className="flex items-center gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url !== (pub.post_url ?? '') && save({ post_url: url || null })}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          placeholder="Link zum veröffentlichten Beitrag"
          aria-label="Link zum Beitrag"
        />
        {pub.post_url ? (
          <a href={pub.post_url} target="_blank" rel="noreferrer" title={displayUrl(pub.post_url)} className="shrink-0 text-accent">
            <ExternalLink className="size-4" />
          </a>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        {pub.status === 'veroeffentlicht' ? <Badge tone="success">Veröffentlicht</Badge> : <Badge>Geplant</Badge>}
        <IconButton label="Veröffentlichung entfernen" onClick={() => run('DELETE', `/publications/${pub.id}`)}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}

export function PublicationsPanel({ project }: { project: ProjectDetail }) {
  const { run, pending } = useRun();
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

  return (
    <div className="grid gap-3">
      {project.publications.length > 0 ? (
        <ul className="divide-y divide-line">
          {project.publications.map((p) => (
            <PublicationRow key={p.id} pub={p} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Noch keine Veröffentlichung geplant.</p>
      )}
      <form
        className="grid gap-2 rounded-md border border-dashed border-line-strong p-3 sm:grid-cols-[150px_150px_100px_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run('POST', `/projects/${project.id}/publications`, { platform, planned_date: date || null, planned_time: time || null })) {
            setDate('');
            setTime('');
          }
        }}
      >
        <Field label="Plattform">
          <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Geplant am">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Uhrzeit">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Button type="submit" icon={<Plus className="size-4" />} loading={pending}>
          Planen
        </Button>
      </form>
      <p className="text-xs text-subtle">
        Sobald für alle geplanten Veröffentlichungen ein Link eingetragen ist, wird das Projekt automatisch abgeschlossen.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Verlauf
// ---------------------------------------------------------------------

export function TransitionList({ project }: { project: ProjectDetail }) {
  return (
    <ul className="grid gap-2.5 text-sm">
      {project.transitions.map((t) => (
        <li key={t.id} className="flex gap-2.5">
          <Clock className="mt-0.5 size-3.5 shrink-0 text-subtle" />
          <div>
            <div className="text-fg">
              {t.from_phase ? `${PHASE_LABELS[t.from_phase]} → ${PHASE_LABELS[t.to_phase]}` : PHASE_LABELS[t.to_phase]}
            </div>
            <div className="text-xs text-muted">
              {formatDateTime(t.moved_at)}
              {t.reason ? ` · ${t.reason}` : ''}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
