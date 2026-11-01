// Aufgabenübersicht, gruppiert nach Fälligkeit.
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTasks } from '../api/projects';
import { TaskDialog, TaskQuickAdd, TaskRow } from '../components/Tasks';
import { Button, Card, EmptyState, ErrorBox, PageHeader, Segmented, Spinner } from '../components/ui';
import { today } from '../lib/format';
import type { Task } from '../../../shared/schemas';

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function group(tasks: Task[]) {
  const t = today();
  const week = addDays(t, 7);
  const groups: { key: string; title: string; items: Task[] }[] = [
    { key: 'overdue', title: 'Überfällig', items: [] },
    { key: 'today', title: 'Heute', items: [] },
    { key: 'week', title: 'Nächste 7 Tage', items: [] },
    { key: 'later', title: 'Später', items: [] },
    { key: 'none', title: 'Ohne Termin', items: [] },
  ];
  for (const task of tasks) {
    const d = task.due_date;
    const g = !d ? 4 : d < t ? 0 : d === t ? 1 : d <= week ? 2 : 3;
    groups[g].items.push(task);
  }
  return groups.filter((g) => g.items.length);
}

export function TasksPage() {
  const [status, setStatus] = useState<'offen' | 'erledigt'>('offen');
  const { data, isLoading, error } = useTasks({ status });
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const groups = useMemo(() => (data && status === 'offen' ? group(data) : []), [data, status]);

  return (
    <>
      <PageHeader
        title="Aufgaben"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Neue Aufgabe
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'offen', label: 'Offen' },
            { value: 'erledigt', label: 'Erledigt' },
          ]}
        />
      </div>

      {status === 'offen' && (
        <Card className="mb-5">
          <TaskQuickAdd />
        </Card>
      )}

      {error ? (
        <ErrorBox error={error} />
      ) : isLoading || !data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            title={status === 'offen' ? 'Keine offenen Aufgaben' : 'Noch keine erledigten Aufgaben'}
            text={status === 'offen' ? 'Neue Aufgaben kannst du oben schnell erfassen oder direkt im Projekt anlegen.' : undefined}
          />
        </Card>
      ) : status === 'offen' ? (
        <div className="grid gap-5">
          {groups.map((g) => (
            <Card key={g.key} title={`${g.title} (${g.items.length})`}>
              <ul className="-my-2.5 divide-y divide-line">
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} onEdit={setEditing} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <ul className="-my-2.5 divide-y divide-line">
            {data.slice(0, 200).map((t) => (
              <TaskRow key={t.id} task={t} onEdit={setEditing} />
            ))}
          </ul>
        </Card>
      )}

      <TaskDialog open={!!editing || creating} task={editing} onClose={() => (setEditing(null), setCreating(false))} />
    </>
  );
}
