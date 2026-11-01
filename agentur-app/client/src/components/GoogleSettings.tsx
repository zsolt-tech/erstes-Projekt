// Einstellungen: Google-Verbindung, Drive-Ordnerstruktur, Warteschlange.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleCheck, Copy, FileUp, LogIn, RefreshCw, TriangleAlert, Unplug } from 'lucide-react';
import { ApiError } from '../api/client';
import { useSaveSettings, useSettings } from '../api/hooks';
import { useDisconnectGoogle, useGoogleStatus, useRetryJob, useSaveCredentials, useSyncJobs } from '../api/google';
import { ConfirmDialog, useToast } from './feedback';
import { Badge, Button, Card, Field, Input, Spinner } from './ui';
import { formatDateTime } from '../lib/format';

function CopyField({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className="flex gap-2">
      <Input value={value} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Weiterleitungs-URI" />
      <Button
        size="sm"
        icon={<Copy className="size-4" />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast.success('Kopiert');
          } catch {
            toast.error('Kopieren nicht möglich, bitte von Hand markieren.');
          }
        }}
      >
        Kopieren
      </Button>
    </div>
  );
}

function Connection() {
  const { data: status, isLoading } = useGoogleStatus();
  const saveCredentials = useSaveCredentials();
  const disconnect = useDisconnectGoogle();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [params, setParams] = useSearchParams();

  // Rückkehr von der Google-Anmeldung
  useEffect(() => {
    const result = params.get('google');
    if (!result) return;
    if (result === 'verbunden') toast.success(`Mit Google verbunden: ${params.get('konto') ?? ''}`);
    else toast.error(`Verbindung fehlgeschlagen: ${params.get('grund') ?? 'unbekannter Fehler'}`);
    setParams({}, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const result = await saveCredentials.mutateAsync(await file.text());
      toast.success('Zugangsdaten gespeichert');
      if (!result.redirect_uri_ok) {
        toast.error('Hinweis: In der Datei fehlt die Weiterleitungs-URI unten. Bitte in der Google Cloud Console beim Client ergänzen.');
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : err);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  if (isLoading || !status) return <Spinner />;

  return (
    <div className="grid gap-4">
      {status.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-success/30 bg-success-soft/60 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <CircleCheck className="size-5 text-success" />
            <div>
              <div className="text-sm font-medium text-fg">Verbunden mit {status.email}</div>
              {status.connected_at && <div className="text-xs text-muted">seit {formatDateTime(status.connected_at)}</div>}
            </div>
          </div>
          <Button size="sm" icon={<Unplug className="size-4" />} onClick={() => setConfirm(true)}>
            Trennen
          </Button>
        </div>
      ) : status.configured ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-4 py-3">
          <div className="text-sm">
            <div className="font-medium text-fg">Zugangsdaten sind hinterlegt</div>
            <div className="text-muted">Jetzt mit deinem Google-Konto anmelden und den Zugriff erlauben.</div>
          </div>
          <Button variant="primary" icon={<LogIn className="size-4" />} onClick={() => (window.location.href = '/api/google/auth')}>
            Mit Google verbinden
          </Button>
        </div>
      ) : (
        <div className="rounded-md border border-line bg-surface-2 px-4 py-3 text-sm">
          <div className="font-medium text-fg">Noch nicht eingerichtet</div>
          <p className="mt-1 text-muted">
            Lege in der Google Cloud Console einen Client vom Typ „Webanwendung“ an (Anleitung: docs/GOOGLE-EINRICHTUNG.md im
            App-Ordner) und wähle hier die heruntergeladene JSON-Datei aus. Die App trägt die Werte selbst in die .env ein.
          </p>
        </div>
      )}

      {status.missing_scopes.length > 0 && (
        <p className="flex items-start gap-2 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Es fehlen Berechtigungen. Bitte trennen und erneut verbinden, dabei alle Häkchen bestätigen.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Weiterleitungs-URI" hint="Muss in der Google Cloud Console beim Client exakt so eingetragen sein">
          <CopyField value={status.redirect_uri} />
        </Field>
        <Field label="Zugangsdaten" hint={status.configured ? 'Eine neue Datei ersetzt die bisherigen Zugangsdaten' : 'Datei „client_secret_....json“ von Google'}>
          <div>
            <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button icon={<FileUp className="size-4" />} loading={saveCredentials.isPending} onClick={() => fileInput.current?.click()}>
              {status.configured ? 'Neue Datei auswählen' : 'JSON-Datei auswählen'}
            </Button>
          </div>
        </Field>
      </div>

      <ConfirmDialog
        open={confirm}
        title="Google-Verbindung trennen?"
        text="Die App legt dann keine Ordner mehr an und prüft Drive nicht mehr. Bestehende Ordner und Verknüpfungen bleiben erhalten. Du kannst jederzeit neu verbinden."
        confirmLabel="Trennen"
        danger
        loading={disconnect.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          try {
            await disconnect.mutateAsync();
            toast.success('Google-Verbindung getrennt');
          } catch (err) {
            toast.error(err);
          }
          setConfirm(false);
        }}
      />
    </div>
  );
}

const ROLE_LABELS = ['Rohmaterial', 'Schnitt / Entwürfe', 'Fertige Videos (wird für die Upload-Erkennung geprüft)', 'Freigabe'];

function FolderSettings() {
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const toast = useToast();
  const [root, setRoot] = useState('');
  const [subs, setSubs] = useState<string[]>(['', '', '', '']);
  const [customerSubs, setCustomerSubs] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!settings) return;
    setRoot(settings.drive_root_folder);
    setSubs(settings.drive_subfolders);
    setCustomerSubs(settings.drive_customer_subfolders.join(', '));
  }, [settings]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({
        drive_root_folder: root,
        drive_subfolders: subs,
        drive_customer_subfolders: customerSubs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setErrors({});
      toast.success('Ordnerstruktur gespeichert. Sie gilt für neu angelegte Ordner.');
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      toast.error(err);
    }
  }

  const year = new Date().getFullYear();
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stammordner in „Meine Ablage“" hint="Leer lassen, um Kundenordner direkt in „Meine Ablage“ anzulegen">
          <Input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="direkt in Meine Ablage" />
        </Field>
        <Field label="Unterordner je Kunde" hint="Durch Komma getrennt, z. B. Scripts, Sonstiges">
          <Input value={customerSubs} onChange={(e) => setCustomerSubs(e.target.value)} />
        </Field>
      </div>
      <div>
        <div className="mb-1 text-[13px] font-medium text-muted">Unterordner je Projekt</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {subs.map((value, i) => (
            <Field key={i} label={ROLE_LABELS[i]} error={errors[`drive_subfolders.${i}`]}>
              <Input value={value} onChange={(e) => setSubs((s) => s.map((x, j) => (j === i ? e.target.value : x)))} invalid={!!errors[`drive_subfolders.${i}`]} />
            </Field>
          ))}
        </div>
      </div>
      <div className="rounded-md bg-surface-2 px-3 py-2.5 font-mono text-xs leading-relaxed text-muted">
        {root ? `${root} / ` : 'Meine Ablage / '}Kunde / {year} / {year}-11 Projekttitel / {subs.join(', ')}
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={save.isPending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

const STATUS_LABEL = { wartend: 'wartet', laeuft: 'läuft', fertig: 'erledigt', fehler: 'fehlgeschlagen' } as const;
const STATUS_TONE = { wartend: 'neutral', laeuft: 'accent', fertig: 'success', fehler: 'danger' } as const;

function Queue() {
  const { data = [] } = useSyncJobs();
  const retry = useRetryJob();
  const open = data.filter((j) => j.status !== 'fertig');
  const recent = data.filter((j) => j.status === 'fertig').slice(0, 5);
  if (!data.length) return <p className="text-sm text-muted">Keine Aufträge.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {[...open, ...recent].map((j) => (
        <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
          <span className="min-w-0 flex-1 text-fg">{j.label}</span>
          <span className="text-xs text-subtle">{formatDateTime(j.updated_at)}</span>
          {(j.status === 'fehler' || (j.status === 'wartend' && j.attempts > 0)) && (
            <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => retry.mutate(j.id)}>
              Jetzt erneut
            </Button>
          )}
          {j.last_error && j.status !== 'fertig' && <p className="w-full text-xs text-danger">{j.last_error}</p>}
        </li>
      ))}
    </ul>
  );
}

export function GoogleSettings() {
  return (
    <>
      <Card title="Google-Verbindung">
        <Connection />
      </Card>
      <Card title="Drive-Ordnerstruktur">
        <FolderSettings />
      </Card>
      <Card title="Google-Aufträge">
        <p className="mb-3 text-sm text-muted">
          Ordner werden über eine Warteschlange angelegt. Ohne Internet bleiben Aufträge liegen und werden automatisch nachgeholt.
        </p>
        <Queue />
      </Card>
    </>
  );
}
