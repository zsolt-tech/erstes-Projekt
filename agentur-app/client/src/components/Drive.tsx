// Drive-Bereiche für Kunden- und Projektseiten.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FolderOpen, FolderPlus, Link2, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useCustomerDrive, useDriveAction, useProjectDrive } from '../api/google';
import { useToast } from './feedback';
import { Badge, Button, Card, Input, Spinner } from './ui';
import { formatDateTime } from '../lib/format';
import { DRIVE_ROLE_LABELS, type DriveFolder } from '../../../shared/schemas';

function LinkForm({ onSubmit, pending, placeholder }: { onSubmit: (url: string) => Promise<unknown>; pending: boolean; placeholder: string }) {
  const [url, setUrl] = useState('');
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        if (!url.trim()) return;
        if (await onSubmit(url)) setUrl('');
      }}
    >
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={placeholder} aria-label="Link zum Drive-Ordner" className="h-8" />
      <Button size="sm" type="submit" icon={<Link2 className="size-4" />} loading={pending} disabled={!url.trim()}>
        Verknüpfen
      </Button>
    </form>
  );
}

function FolderLink({ folder, label }: { folder: DriveFolder; label?: string }) {
  return (
    <a href={folder.web_url} target="_blank" rel="noreferrer" className="group flex items-center gap-2 text-sm text-fg hover:text-accent">
      <FolderOpen className="size-4 shrink-0 text-subtle group-hover:text-accent" />
      <span className="min-w-0 flex-1 truncate">{label ?? folder.name}</span>
      <ExternalLink className="size-3.5 shrink-0 text-subtle" />
    </a>
  );
}

function NotConnected() {
  return (
    <p className="text-sm text-muted">
      Google ist nicht verbunden.{' '}
      <Link to="/einstellungen" className="text-accent hover:underline">
        In den Einstellungen verbinden
      </Link>
    </p>
  );
}

// ---------------------------------------------------------------------
// Kunde
// ---------------------------------------------------------------------

export function CustomerDriveCard({ customerId, isLead }: { customerId: number; isLead: boolean }) {
  const { data, isLoading } = useCustomerDrive(customerId);
  const action = useDriveAction('customers', customerId);
  const toast = useToast();
  const [showLink, setShowLink] = useState(false);

  const run = async (method: 'POST' | 'DELETE', path: string, body?: unknown, success?: string) => {
    try {
      const r = await action.mutateAsync({ method, path, body });
      if (success) toast.success(success);
      return r;
    } catch (err) {
      toast.error(err);
      return null;
    }
  };

  return (
    <Card title="Google Drive">
      {isLoading || !data ? (
        <Spinner />
      ) : data.state === 'bereit' && data.folder ? (
        <div className="grid gap-3">
          <FolderLink folder={data.folder} />
          <div className="flex items-center justify-between gap-2 text-xs text-subtle">
            <span>{data.folder.origin === 'verknuepft' ? 'Bestehender Ordner, verknüpft' : 'Von der App angelegt'}</span>
            <button
              type="button"
              className="hover:text-danger"
              onClick={() => run('DELETE', '', undefined, 'Verknüpfung gelöst. Der Ordner in Drive bleibt erhalten.')}
            >
              Verknüpfung lösen
            </button>
          </div>
        </div>
      ) : data.state === 'nicht_verbunden' ? (
        <NotConnected />
      ) : (
        <div className="grid gap-3">
          {data.state === 'wartet' && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle className="size-4 animate-spin" />
              Ordner wird angelegt ...
            </p>
          )}
          {data.state === 'fehler' && (
            <p className="flex items-start gap-2 text-sm text-danger">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {data.error}
            </p>
          )}
          {data.state === 'fehlt' && (
            <p className="text-sm text-muted">
              {isLead ? 'Interessenten bekommen erst bei der Umwandlung in einen Kunden einen Ordner.' : 'Noch kein Ordner verknüpft.'}
            </p>
          )}
          {data.state !== 'wartet' && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<FolderPlus className="size-4" />} loading={action.isPending} onClick={() => run('POST', '/create', undefined, 'Ordner wird angelegt')}>
                {data.state === 'fehler' ? 'Erneut versuchen' : 'Ordner anlegen'}
              </Button>
              <Button size="sm" variant="ghost" icon={<Link2 className="size-4" />} onClick={() => setShowLink((v) => !v)}>
                Bestehenden verknüpfen
              </Button>
            </div>
          )}
          {showLink && (
            <LinkForm
              placeholder="Link zum Ordner in Drive einfügen"
              pending={action.isPending}
              onSubmit={async (url) => {
                const ok = await run('POST', '/link', { url }, 'Ordner verknüpft');
                if (ok) setShowLink(false);
                return ok;
              }}
            />
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// Projekt
// ---------------------------------------------------------------------

export function ProjectDrivePanel({ projectId, customerId }: { projectId: number; customerId: number }) {
  const { data, isLoading } = useProjectDrive(projectId);
  const action = useDriveAction('projects', projectId);
  const toast = useToast();
  const [showLink, setShowLink] = useState(false);

  const run = async (method: 'POST' | 'DELETE', path: string, body?: unknown, success?: string) => {
    try {
      const r = await action.mutateAsync({ method, path, body });
      if (success) toast.success(success);
      return r;
    } catch (err) {
      toast.error(err);
      return null;
    }
  };

  if (isLoading || !data) return <Spinner />;
  const byRole = Object.fromEntries(data.folders.map((f) => [f.role, f]));
  const final = byRole.final as DriveFolder | undefined;

  return (
    <div className="rounded-md border border-line p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-fg">Google Drive</h3>
        {data.state === 'bereit' && (
          <button type="button" className="text-xs text-subtle hover:text-danger" onClick={() => run('DELETE', '', undefined, 'Verknüpfung gelöst. Die Ordner in Drive bleiben erhalten.')}>
            Verknüpfung lösen
          </button>
        )}
      </div>

      {data.state === 'bereit' ? (
        <div className="grid gap-4">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(['projekt', 'rohmaterial', 'schnitt', 'final', 'freigabe'] as const).map((role) =>
              byRole[role] ? (
                <FolderLink key={role} folder={byRole[role]} label={role === 'projekt' ? `Projektordner: ${byRole[role].name}` : byRole[role].name ?? DRIVE_ROLE_LABELS[role]} />
              ) : (
                <span key={role} className="flex items-center gap-2 text-sm text-subtle">
                  <FolderOpen className="size-4" /> {DRIVE_ROLE_LABELS[role]}: nicht vorhanden
                </span>
              ),
            )}
          </div>

          {final ? (
            <div className="rounded-md bg-surface-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  {data.final_file_count === null ? (
                    <span className="text-muted">Noch nicht geprüft</span>
                  ) : data.final_file_count === 0 ? (
                    <span className="text-muted">Keine Dateien in „{final.name}“</span>
                  ) : (
                    <Badge tone="success">
                      {data.final_file_count} {data.final_file_count === 1 ? 'Datei' : 'Dateien'} in „{final.name}“
                    </Badge>
                  )}
                  {data.final_checked_at && <span className="ml-2 text-xs text-subtle">geprüft {formatDateTime(data.final_checked_at)}</span>}
                </div>
                <Button size="sm" icon={<RefreshCw className="size-4" />} loading={action.isPending} onClick={() => run('POST', '/check')}>
                  Jetzt prüfen
                </Button>
              </div>
              {data.final_files.length > 0 && (
                <ul className="mt-2 grid gap-1 text-sm">
                  {data.final_files.slice(0, 8).map((f) => (
                    <li key={f.url}>
                      <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-muted hover:text-accent">
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        {f.modified_at && <span className="shrink-0 text-xs text-subtle">{formatDateTime(f.modified_at)}</span>}
                      </a>
                    </li>
                  ))}
                  {data.final_files.length > 8 && <li className="text-xs text-subtle">und {data.final_files.length - 8} weitere</li>}
                </ul>
              )}
              <p className="mt-2 text-xs text-subtle">
                Wird automatisch alle 15 Minuten geprüft. Sobald dort eine Datei liegt, wird „Dateien im Ordner Fertige Videos“ abgehakt.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">
              Im verknüpften Ordner gibt es keinen Unterordner für fertige Videos. Lege in Drive einen Ordner „Fertige Videos“ an und verknüpfe den Projektordner erneut.
            </p>
          )}
        </div>
      ) : data.state === 'nicht_verbunden' ? (
        <NotConnected />
      ) : (
        <div className="grid gap-3">
          {data.state === 'wartet' && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle className="size-4 animate-spin" /> Ordner werden angelegt ...
            </p>
          )}
          {data.state === 'fehler' && (
            <p className="flex items-start gap-2 text-sm text-danger">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {data.error}
            </p>
          )}
          {data.state === 'fehlt' && !data.customer_folder && (
            <p className="text-sm text-muted">
              Der Kunde hat noch keinen Drive-Ordner.{' '}
              <Link to={`/kunden/${customerId}`} className="text-accent hover:underline">
                Auf der Kundenseite anlegen oder verknüpfen
              </Link>
              , oder hier einen bestehenden Projektordner verknüpfen.
            </p>
          )}
          {data.state === 'fehlt' && data.customer_folder && <p className="text-sm text-muted">Für dieses Projekt gibt es noch keine Ordner.</p>}
          {data.state !== 'wartet' && (
            <div className="flex flex-wrap gap-2">
              {data.customer_folder && (
                <Button size="sm" icon={<FolderPlus className="size-4" />} loading={action.isPending} onClick={() => run('POST', '/create', undefined, 'Ordner werden angelegt')}>
                  {data.state === 'fehler' ? 'Erneut versuchen' : 'Ordner anlegen'}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Link2 className="size-4" />} onClick={() => setShowLink((v) => !v)}>
                Bestehenden Ordner verknüpfen
              </Button>
            </div>
          )}
          {showLink && (
            <>
              <LinkForm
                placeholder="Link zum Projekt- oder Kundenordner einfügen"
                pending={action.isPending}
                onSubmit={async (url) => {
                  const ok = await run('POST', '/link', { url }, 'Ordner verknüpft');
                  if (ok) setShowLink(false);
                  return ok;
                }}
              />
              <p className="text-xs text-subtle">
                Unterordner wie „Rohmaterial“, „Entwürfe“ und „Fertige Videos“ werden automatisch erkannt, auch ohne Nummern davor.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
