// Aufgabenliste, Schnellerfassung und Bearbeitungsdialog.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError } from '../api/client';
import { useCustomers, useTeam } from '../api/hooks';
import { useDeleteTask, useProjects, useSaveTask, useSetTaskStatus } from '../api/projects';
import { Dialog, useToast } from './feedback';
import { Badge, Button, Field, IconButton, Input, Select, Textarea, cx } from './ui';
import { formatDate, today } from '../lib/format';
import {
  PHASES,
  PHASE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type Priority,
  type Task,
  type TaskInput,
  type TaskStatus,
} from '../../../shared/schemas';

export function dueLabel(task: Pick<Task, 'due_date' | 'due_time' | 'status'>): { text: string; tone: 'danger' | 'warning' | 'muted' } | null {
  if (!task.due_date) return null;
  const t = today();
  const time = task.due_time ? `, ${task.due_time} Uhr` : '';
  if (task.status !== 'erledigt' && task.due_date < t) return { text: `überfällig seit ${formatDate(task.due_date)}`, tone: 'danger' };
  if (task.due_date === t) return { text: `heute${time}`, tone: 'warning' };
  return { text: `${formatDate(task.due_date)}${time}`, tone: 'muted' };
}

export function TaskRow({ task, onEdit, showLinks = true }: { task: Task; onEdit: (t: Task) => void; showLinks?: boolean }) {
  const setStatus = useSetTaskStatus();
  const remove = useDeleteTask();
  const toast = useToast();
  const done = task.status === 'erledigt';
  const due = dueLabel(task);

  async function toggle() {
    try {
      await setStatus.mutateAsync({ id: task.id, status: done ? 'offen' : 'erledigt' });
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <li className="group flex items-start gap-3 py-2.5">
      <input
        type="checkbox"
        checked={done}
        onChange={toggle}
        aria-label={done ? 'Als offen markieren' : 'Als erledigt markieren'}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
      />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onEdit(task)} className={cx('text-left text-sm hover:text-accent', done ? 'text-subtle line-through' : 'text-fg')}>
          {task.title}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          {due && (
            <span className={due.tone === 'danger' ? 'font-medium text-danger' : due.tone === 'warning' ? 'font-medium text-warning' : undefined}>
              {due.text}
            </span>
          )}
          {showLinks && task.customer_name && task.customer_id && (
            <Link to={`/kunden/${task.customer_id}`} className="hover:text-accent">
              {task.customer_name}
            </Link>
          )}
          {showLinks && task.project_title && task.project_id && (
            <Link to={`/projekte/${task.project_id}`} className="hover:text-accent">
              {task.project_title}
              {task.phase ? ` · ${PHASE_LABELS[task.phase]}` : ''}
            </Link>
          )}
          {task.status === 'in_arbeit' && <Badge tone="accent">In Arbeit</Badge>}
          {task.priority === 'hoch' && !done && <Badge tone="danger">Hoch</Badge>}
          {task.assignee_name && <span>{task.assignee_name}</span>}
        </div>
      </div>
      <IconButton
        label="Aufgabe löschen"
        className="opacity-0 group-hover:opacity-100 focus:opacity-100"
        onClick={async () => {
          try {
            await remove.mutateAsync(task.id);
            toast.success('Aufgabe gelöscht');
          } catch (err) {
            toast.error(err);
          }
        }}
      >
        <Trash2 className="size-4" />
      </IconButton>
    </li>
  );
}

/** Schnellerfassung: Titel und Fälligkeit, Zuordnung kommt aus dem Kontext */
export function TaskQuickAdd({ customerId, projectId, phase }: { customerId?: number; projectId?: number; phase?: number }) {
  const save = useSaveTask();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await save.mutateAsync({
        data: { title, due_date: due || null, customer_id: customerId ?? null, project_id: projectId ?? null, phase: phase ?? null },
      });
      setTitle('');
      setDue('');
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2">
      <div className="min-w-48 flex-1">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Neue Aufgabe" aria-label="Neue Aufgabe" />
      </div>
      <div className="w-40">
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fällig am" />
      </div>
      <Button type="submit" icon={<Plus className="size-4" />} loading={save.isPending} disabled={!title.trim()}>
        Hinzufügen
      </Button>
    </form>
  );
}

interface TaskForm {
  title: string;
  description: string;
  customer_id: string;
  project_id: string;
  phase: string;
  due_date: string;
  due_time: string;
  assignee_id: string;
  priority: Priority;
  status: TaskStatus;
}

const toForm = (t?: Partial<Task>): TaskForm => ({
  title: t?.title ?? '',
  description: t?.description ?? '',
  customer_id: t?.customer_id ? String(t.customer_id) : '',
  project_id: t?.project_id ? String(t.project_id) : '',
  phase: t?.phase ? String(t.phase) : '',
  due_date: t?.due_date ?? '',
  due_time: t?.due_time ?? '',
  assignee_id: t?.assignee_id ? String(t.assignee_id) : '',
  priority: t?.priority ?? 'normal',
  status: t?.status ?? 'offen',
});

/** Dialog zum Anlegen und Bearbeiten. task = null: neu */
export function TaskDialog({
  open,
  task,
  defaults,
  onClose,
}: {
  open: boolean;
  task: Task | null;
  defaults?: Partial<Task>;
  onClose: () => void;
}) {
  const save = useSaveTask();
  const toast = useToast();
  const { data: customers = [] } = useCustomers({});
  const { data: team = [] } = useTeam();
  const [form, setForm] = useState<TaskForm>(toForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { data: projects = [] } = useProjects({
    scope: 'offen',
    customer_id: form.customer_id ? Number(form.customer_id) : undefined,
  });

  // Nur beim Öffnen befüllen; defaults kann bei jedem Rendern ein neues Objekt sein
  useEffect(() => {
    if (open) {
      setForm(toForm(task ?? defaults));
      setErrors({});
    }
  }, [open, task]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof TaskForm>(k: K, v: TaskForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const data: TaskInput = {
      title: form.title,
      description: form.description,
      customer_id: form.customer_id ? Number(form.customer_id) : null,
      project_id: form.project_id ? Number(form.project_id) : null,
      phase: form.project_id && form.phase ? Number(form.phase) : null,
      due_date: form.due_date || null,
      due_time: form.due_time || null,
      assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
      priority: form.priority,
      status: form.status,
    };
    try {
      await save.mutateAsync({ id: task?.id, data });
      toast.success(task ? 'Aufgabe gespeichert' : 'Aufgabe angelegt');
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      toast.error(err);
    }
  }

  const activeTeam = team.filter((m) => m.active || String(m.id) === form.assignee_id);
  // Projekt der Aufgabe auch anzeigen, wenn es nicht mehr läuft
  const projectOptions = projects.some((p) => String(p.id) === form.project_id) || !task?.project_id
    ? projects
    : [...projects, { id: task.project_id, title: task.project_title ?? 'Projekt' }];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => submit()} loading={save.isPending}>
            Speichern
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <button type="submit" hidden />
        <Field label="Titel" required error={errors.title} className="sm:col-span-2">
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} invalid={!!errors.title} autoFocus />
        </Field>
        <Field label="Fällig am">
          <Input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
        </Field>
        <Field label="Uhrzeit">
          <Input type="time" value={form.due_time} onChange={(e) => set('due_time', e.target.value)} />
        </Field>
        <Field label="Kunde">
          <Select
            value={form.customer_id}
            onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value, project_id: '', phase: '' }))}
          >
            <option value="">Ohne Kunde</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Projekt">
          <Select
            value={form.project_id}
            onChange={(e) => {
              const p = projects.find((x) => String(x.id) === e.target.value);
              setForm((f) => ({
                ...f,
                project_id: e.target.value,
                customer_id: p ? String(p.customer_id) : f.customer_id,
                phase: p ? String(p.current_phase) : '',
              }));
            }}
          >
            <option value="">Ohne Projekt</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
        {form.project_id && (
          <Field label="Phase">
            <Select value={form.phase} onChange={(e) => set('phase', e.target.value)}>
              <option value="">Keine</option>
              {PHASES.map((ph) => (
                <option key={ph} value={ph}>
                  {PHASE_LABELS[ph]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Priorität">
          <Select value={form.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        {activeTeam.length > 0 && (
          <Field label="Verantwortlich">
            <Select value={form.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
              <option value="">Ich selbst</option>
              {activeTeam.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Beschreibung" className="sm:col-span-2">
          <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} />
        </Field>
      </form>
    </Dialog>
  );
}
