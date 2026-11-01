// Kanban-Board: Spalten sind die fünf Phasen, Karten lassen sich per Drag-and-Drop verschieben.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CalendarDays, Clock, Lock, RotateCcw, Video } from 'lucide-react';
import { useProjectAction } from '../api/projects';
import { useToast } from './feedback';
import { Badge, ProgressBar, cx } from './ui';
import { formatDate } from '../lib/format';
import { PHASES, PHASE_LABELS, type Phase, type ProjectListItem } from '../../../shared/schemas';

export function ProjectCardBody({ p, dragging }: { p: ProjectListItem; dragging?: boolean }) {
  return (
    <div
      className={cx(
        'rounded-md border bg-surface p-3 text-left shadow-sm transition-shadow',
        dragging ? 'border-accent shadow-lg' : 'border-line hover:border-line-strong',
        p.status === 'pausiert' && 'opacity-70',
      )}
    >
      <div className="text-[13px] leading-snug font-medium text-fg">{p.title}</div>
      <div className="mt-0.5 truncate text-xs text-muted">{p.customer_name}</div>

      <div className="mt-2 flex flex-wrap gap-1">
        {p.status === 'pausiert' && <Badge tone="warning">Pausiert</Badge>}
        {p.priority === 'hoch' && <Badge tone="danger">Hoch</Badge>}
        {p.open_gates > 0 && (
          <Badge tone="warning">
            <Lock className="mr-1 size-3" />
            QS offen
          </Badge>
        )}
        {p.current_phase === 4 && p.approval_waiting_days !== null && (
          <Badge tone={p.approval_waiting_days >= 3 ? 'danger' : 'violet'}>
            <Clock className="mr-1 size-3" />
            wartet {p.approval_waiting_days === 1 ? '1 Tag' : `${p.approval_waiting_days} Tage`}
          </Badge>
        )}
        {p.correction_count > 0 && (
          <Badge>
            <RotateCcw className="mr-1 size-3" />
            {p.correction_count} {p.correction_count === 1 ? 'Korrektur' : 'Korrekturen'}
          </Badge>
        )}
      </div>

      <div className="mt-2 grid gap-1 text-xs text-muted">
        {p.current_phase === 1 && p.shoot_date && (
          <span className="inline-flex items-center gap-1.5">
            <Video className="size-3.5" />
            Dreh {formatDate(p.shoot_date)}
            {p.start_time ? `, ${p.start_time} Uhr` : ''}
          </span>
        )}
        {p.phase_due_date && !(p.current_phase === 1 && p.phase_due_date === p.shoot_date && !p.overdue) && (
          <span className={cx('inline-flex items-center gap-1.5', p.overdue && 'font-medium text-danger')}>
            <CalendarDays className="size-3.5" />
            {p.overdue ? 'Überfällig seit' : 'Fällig'} {formatDate(p.phase_due_date)}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <ProgressBar value={p.progress} max={100} tone={p.overdue ? 'danger' : 'accent'} />
        <span className="w-8 shrink-0 text-right text-[11px] tabular text-muted">{p.progress} %</span>
      </div>
    </div>
  );
}

function DraggableCard({ p }: { p: ProjectListItem }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: p.id, data: { project: p } });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => navigate(`/projekte/${p.id}`)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter') navigate(`/projekte/${p.id}`);
      }}
      className={cx('cursor-grab touch-none rounded-md active:cursor-grabbing', isDragging && 'opacity-30')}
      aria-label={`${p.title}, ${p.customer_name}. Mit Leertaste aufnehmen und mit Pfeiltasten verschieben, Enter öffnet das Projekt.`}
    >
      <ProjectCardBody p={p} />
    </div>
  );
}

function Column({ phase, items }: { phase: Phase; items: ProjectListItem[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `phase-${phase}`, data: { phase } });
  const overdue = items.filter((p) => p.overdue).length;
  return (
    <section
      ref={setNodeRef}
      className={cx(
        'flex w-64 shrink-0 flex-col rounded-lg border bg-surface-2 transition-colors lg:w-auto lg:min-w-0 lg:flex-1',
        isOver ? 'border-accent bg-accent-soft/50' : 'border-line',
      )}
    >
      <header className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-[13px] font-semibold text-fg">
            <span className="text-subtle">{phase}</span> {PHASE_LABELS[phase]}
          </h2>
          <span className="shrink-0 rounded bg-surface-3 px-1.5 text-xs font-medium tabular text-muted">{items.length}</span>
        </div>
        {overdue > 0 && <div className="mt-0.5 text-xs font-medium text-danger">{overdue} überfällig</div>}
      </header>
      <div className="flex min-h-32 flex-1 flex-col gap-2 px-2 pb-2">
        {items.map((p) => (
          <DraggableCard key={p.id} p={p} />
        ))}
        {items.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-line-strong p-4 text-center text-xs text-subtle">
            Keine Projekte
          </div>
        )}
      </div>
    </section>
  );
}

export function ProjectBoard({ projects }: { projects: ProjectListItem[] }) {
  const action = useProjectAction();
  const toast = useToast();
  const [active, setActive] = useState<ProjectListItem | null>(null);
  // Sofortige Anzeige des Ziels, bis der Server antwortet
  const [pending, setPending] = useState<Record<number, Phase>>({});
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const phaseOf = (p: ProjectListItem) => pending[p.id] ?? p.current_phase;

  function onDragStart(e: DragStartEvent) {
    setActive((e.active.data.current?.project as ProjectListItem) ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const p = e.active.data.current?.project as ProjectListItem | undefined;
    const to = e.over?.data.current?.phase as Phase | undefined;
    if (!p || !to || to === phaseOf(p)) return;
    setPending((s) => ({ ...s, [p.id]: to }));
    try {
      await action.mutateAsync({ method: 'POST', url: `/projects/${p.id}/move`, body: { to_phase: to } });
      toast.success(`„${p.title}“ ist jetzt in ${PHASE_LABELS[to]}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setPending((s) => {
        const next = { ...s };
        delete next[p.id];
        return next;
      });
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {PHASES.map((phase) => (
          <Column key={phase} phase={phase} items={projects.filter((p) => phaseOf(p) === phase)} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{active ? <ProjectCardBody p={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
