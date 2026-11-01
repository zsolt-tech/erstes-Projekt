// Projekte als Kanban-Board oder Liste.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Columns3, List, Plus, Search } from 'lucide-react';
import { useCustomers } from '../api/hooks';
import { useProjects, type ProjectScope } from '../api/projects';
import { ProjectBoard } from '../components/ProjectBoard';
import { InvoiceBadge, PhaseBadge, ProjectStatusBadge } from '../components/labels';
import { Button, Card, EmptyState, ErrorBox, Input, PageHeader, ProgressBar, Segmented, Select, Spinner, cx } from '../components/ui';
import { formatDate, formatMonth } from '../lib/format';
import type { ProjectListItem } from '../../../shared/schemas';

type View = 'board' | 'liste';

function readView(): View {
  try {
    return localStorage.getItem('projects-view') === 'liste' ? 'liste' : 'board';
  } catch {
    return 'board';
  }
}

export function ProjectTable({ projects, showCustomer = true }: { projects: ProjectListItem[]; showCustomer?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th className="px-4 py-2.5 font-medium">Projekt</th>
            <th className="px-4 py-2.5 font-medium">Phase</th>
            <th className="w-40 px-4 py-2.5 font-medium">Fortschritt</th>
            <th className="px-4 py-2.5 font-medium">Fällig</th>
            <th className="px-4 py-2.5 font-medium">Leistung</th>
            <th className="px-4 py-2.5 font-medium">Rechnung</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr
              key={p.id}
              onClick={() => navigate(`/projekte/${p.id}`)}
              className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2"
            >
              <td className="px-4 py-3">
                <Link to={`/projekte/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-fg hover:text-accent">
                  {p.title}
                </Link>
                {showCustomer && <div className="text-xs text-muted">{p.customer_name}</div>}
              </td>
              <td className="px-4 py-3">
                {p.status === 'aktiv' ? <PhaseBadge phase={p.current_phase} /> : <ProjectStatusBadge status={p.status} />}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <ProgressBar value={p.progress} max={100} tone={p.overdue ? 'danger' : p.progress === 100 ? 'success' : 'accent'} />
                  <span className="w-9 shrink-0 text-right text-xs tabular text-muted">{p.progress} %</span>
                </div>
              </td>
              <td className={cx('px-4 py-3 whitespace-nowrap', p.overdue ? 'font-medium text-danger' : 'text-muted')}>
                {p.status === 'abgeschlossen' ? `erledigt ${formatDate(p.completed_at)}` : formatDate(p.phase_due_date) || '–'}
              </td>
              <td className="px-4 py-3 text-muted">
                {p.deliverable_type_name ? `${p.deliverable_count} × ${p.deliverable_type_name}` : '–'}
                <div className="text-xs text-subtle">{formatMonth(p.service_month)}</div>
              </td>
              <td className="px-4 py-3">
                <InvoiceBadge status={p.invoice_status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectsPage() {
  const [view, setViewState] = useState<View>(readView);
  const [scope, setScope] = useState<ProjectScope>('offen');
  const [customerId, setCustomerId] = useState('');
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const { data: customers = [] } = useCustomers({});
  const effectiveScope = view === 'board' ? 'offen' : scope;
  const { data, isLoading, error } = useProjects({
    scope: effectiveScope,
    customer_id: customerId ? Number(customerId) : undefined,
    q,
  });

  function setView(v: View) {
    setViewState(v);
    try {
      localStorage.setItem('projects-view', v);
    } catch {
      /* Speicher nicht verfügbar */
    }
  }

  const newUrl = customerId ? `/projekte/neu?kunde=${customerId}` : '/projekte/neu';

  return (
    <>
      <PageHeader
        title="Projekte"
        subtitle={view === 'board' ? 'Laufende Projekte nach Phase. Karten per Drag-and-Drop verschieben.' : 'Alle Projekte als Liste'}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate(newUrl)}>
            Neues Projekt
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            {
              value: 'board',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Columns3 className="size-3.5" /> Board
                </span>
              ),
            },
            {
              value: 'liste',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <List className="size-3.5" /> Liste
                </span>
              ),
            },
          ]}
        />
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Projekt oder Kunde ..." className="pl-9" aria-label="Projekte durchsuchen" />
        </div>
        <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full sm:w-56" aria-label="Kunde filtern">
          <option value="">Alle Kunden</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company_name}
            </option>
          ))}
        </Select>
        {view === 'liste' && (
          <Segmented<ProjectScope>
            value={scope}
            onChange={setScope}
            options={[
              { value: 'offen', label: 'Laufend' },
              { value: 'abgeschlossen', label: 'Abgeschlossen' },
              { value: 'abgebrochen', label: 'Abgebrochen' },
              { value: 'alle', label: 'Alle' },
            ]}
          />
        )}
      </div>

      {error ? (
        <ErrorBox error={error} />
      ) : isLoading || !data ? (
        <Spinner />
      ) : view === 'board' ? (
        data.length === 0 && !q && !customerId ? (
          <Card>
            <EmptyState
              title="Noch keine laufenden Projekte"
              text="Lege ein Projekt an. Checklisten und Fristen werden aus der passenden Vorlage für den Kundentyp übernommen."
              action={
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate(newUrl)}>
                  Neues Projekt
                </Button>
              }
            />
          </Card>
        ) : (
          <ProjectBoard projects={data} />
        )
      ) : (
        <Card padded={false}>
          {data.length === 0 ? <EmptyState title="Keine Projekte gefunden" /> : <ProjectTable projects={data} />}
        </Card>
      )}
    </>
  );
}
