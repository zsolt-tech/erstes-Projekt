// Kundenliste mit Suche, Statusfilter und Archiv.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useCustomers } from '../api/hooks';
import { Button, Card, EmptyState, ErrorBox, Input, PageHeader, Segmented, Spinner, cx } from '../components/ui';
import { CustomerStatusBadge } from '../components/labels';
import { CUSTOMER_TYPE_LABELS, type CustomerStatus } from '../../../shared/schemas';

type StatusFilter = CustomerStatus | '';

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: '', label: 'Alle' },
  { value: 'aktiv', label: 'Aktiv' },
  { value: 'interessent', label: 'Interessenten' },
  { value: 'pausiert', label: 'Pausiert' },
  { value: 'beendet', label: 'Beendet' },
];

export function CustomersPage() {
  const [status, setStatus] = useState<StatusFilter>('');
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const { data, isLoading, error, isFetching } = useCustomers({ status, q, archived });
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Kunden"
        subtitle={archived ? 'Archivierte Kunden' : 'Kunden und Interessenten'}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/kunden/neu')}>
            Neuer Kunde
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Firma, Ort, Ansprechpartner ..."
            className="pl-9"
            aria-label="Kunden durchsuchen"
          />
        </div>
        <div className="max-w-full overflow-x-auto">
          <Segmented value={status} options={FILTERS} onChange={setStatus} />
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-[13px] text-muted select-none">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Archiv anzeigen
        </label>
      </div>

      {error ? (
        <ErrorBox error={error} />
      ) : (
        <Card padded={false}>
          {isLoading ? (
            <Spinner />
          ) : !data || data.length === 0 ? (
            <EmptyState
              title={q || status ? 'Keine Treffer' : archived ? 'Keine archivierten Kunden' : 'Noch keine Kunden angelegt'}
              text={
                q || status
                  ? 'Passe Suche oder Filter an.'
                  : archived
                    ? undefined
                    : 'Lege deinen ersten Kunden an. Ansprechpartner, Kanäle und das gebuchte Paket kannst du direkt mit erfassen.'
              }
              action={
                !q && !status && !archived ? (
                  <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/kunden/neu')}>
                    Neuer Kunde
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className={cx('overflow-x-auto transition-opacity', isFetching && 'opacity-70')}>
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs font-medium text-muted">
                    <th className="px-4 py-2.5 font-medium">Firma</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Ansprechpartner</th>
                    <th className="px-4 py-2.5 font-medium">Ort</th>
                    <th className="px-4 py-2.5 font-medium">Paket pro Monat</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/kunden/${c.id}`)}
                      className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/kunden/${c.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-fg hover:text-accent"
                        >
                          {c.company_name}
                        </Link>
                        <div className="text-xs text-muted">
                          {[c.industry, c.customer_type !== 'sonstige' ? CUSTOMER_TYPE_LABELS[c.customer_type] : null]
                            .filter(Boolean)
                            .join(' · ') || ' '}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <CustomerStatusBadge status={c.status} stage={c.pipeline_stage} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-fg">{c.primary_contact_name || <span className="text-subtle">–</span>}</div>
                        {c.primary_contact_phone && <div className="text-xs text-muted tabular">{c.primary_contact_phone}</div>}
                      </td>
                      <td className="px-4 py-3 text-muted">{c.city || '–'}</td>
                      <td className="px-4 py-3 text-muted">{c.package_summary || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {data && data.length > 0 && (
        <p className="mt-3 text-xs text-subtle">
          {data.length} {data.length === 1 ? 'Eintrag' : 'Einträge'}
        </p>
      )}
    </>
  );
}
