// Startseite. Ab Etappe 5 erscheint hier das tägliche Briefing.
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useCustomers, useSettings } from '../api/hooks';
import { useProjects, useTasks } from '../api/projects';
import { Button, Card, PageHeader } from '../components/ui';
import { formatLongDate, today } from '../lib/format';

function Stat({ label, value, to }: { label: string; value: number | string; to: string }) {
  return (
    <Link to={to} className="rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular text-fg">{value}</div>
    </Link>
  );
}

export function StartPage() {
  const { data: settings } = useSettings();
  const { data: customers = [] } = useCustomers({});
  const { data: projects = [] } = useProjects({ scope: 'offen' });
  const { data: tasks = [] } = useTasks({ status: 'offen' });
  const overdueTasks = tasks.filter((t) => t.due_date && t.due_date < today()).length;
  const waiting = projects.filter((p) => p.current_phase === 4 && p.status === 'aktiv').length;
  const navigate = useNavigate();
  const count = (s: string) => customers.filter((c) => c.status === s).length;
  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';

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
        <Stat label="Aktive Kunden" value={count('aktiv')} to="/kunden" />
        <Stat label="Laufende Projekte" value={projects.length} to="/projekte" />
        <Stat label="Warten auf Freigabe" value={waiting} to="/projekte" />
        <Stat label={overdueTasks ? `Offene Aufgaben, ${overdueTasks} überfällig` : 'Offene Aufgaben'} value={tasks.length} to="/aufgaben" />
      </div>
      <Card title="Tägliches Briefing">
        <p className="text-sm text-muted">
          Ab Etappe 5 erscheint hier jeden Morgen um 9:00 Uhr das Briefing für {settings?.agency_name || 'deine Agentur'}:
          heutige Termine, fällige und überfällige Aufgaben, offene Freigaben, anstehende Drehtage, Paketverbrauch und
          Engpässe.
        </p>
      </Card>
    </>
  );
}
