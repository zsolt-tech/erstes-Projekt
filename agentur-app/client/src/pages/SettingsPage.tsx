// Einstellungen: Allgemein, Darstellung, Freigaben, Leistungsarten, Team, Datensicherung.
import { useEffect, useState, type FormEvent } from 'react';
import { Check, HardDrive, Pencil, Plus, X } from 'lucide-react';
import { ApiError } from '../api/client';
import {
  useBackups,
  useDeliverableTypes,
  useRunBackup,
  useSaveDeliverableType,
  useSaveSettings,
  useSaveTeamMember,
  useSettings,
  useTeam,
} from '../api/hooks';
import { Badge, Button, Card, ErrorBox, Field, IconButton, Input, PageHeader, Segmented, Spinner } from '../components/ui';
import { useToast } from '../components/feedback';
import { GoogleSettings } from '../components/GoogleSettings';
import { useTheme } from '../lib/theme';
import { formatBytes, formatDateTime } from '../lib/format';
import type { DeliverableType, TeamMember, Theme } from '../../../shared/schemas';

function GeneralSettings() {
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const [name, setName] = useState('');
  const [days, setDays] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) {
      setName(settings.agency_name);
      setDays(String(settings.approval_reminder_days));
    }
  }, [settings]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({ agency_name: name, approval_reminder_days: Number(days) });
      setErrors({});
      toast.success('Einstellungen gespeichert');
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      toast.error(err);
    }
  }

  return (
    <Card title="Allgemein">
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name der Agentur" error={errors.agency_name} hint="Erscheint in der Seitenleiste und in Berichten">
          <Input value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.agency_name} />
        </Field>
        <Field
          label="Freigabe-Erinnerung nach Tagen"
          error={errors.approval_reminder_days ? 'Zahl zwischen 1 und 60' : undefined}
          hint="Standard, wenn beim Kunden oder Projekt nichts anderes eingestellt ist"
        >
          <Input
            type="number"
            min={1}
            max={60}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            invalid={!!errors.approval_reminder_days}
          />
        </Field>
        <Field label="Darstellung" hint="Gilt für diesen Rechner">
          <div>
            <Segmented<Theme>
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'system', label: 'Wie System' },
                { value: 'hell', label: 'Hell' },
                { value: 'dunkel', label: 'Dunkel' },
              ]}
            />
          </div>
        </Field>
        <div className="flex items-end justify-end sm:col-span-2">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Speichern
          </Button>
        </div>
      </form>
    </Card>
  );
}

function DeliverableTypeRow({ type }: { type: DeliverableType }) {
  const save = useSaveDeliverableType();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(type.name);

  async function submit(patch: { name?: string; active?: boolean }) {
    try {
      await save.mutateAsync({ id: type.id, name: patch.name ?? type.name, active: patch.active ?? !!type.active });
      setEditing(false);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <li className="flex items-center gap-2 py-2">
      {editing ? (
        <form
          className="flex flex-1 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ name });
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" autoFocus aria-label="Bezeichnung" />
          <IconButton label="Übernehmen" type="submit">
            <Check className="size-4" />
          </IconButton>
          <IconButton
            label="Abbrechen"
            onClick={() => {
              setName(type.name);
              setEditing(false);
            }}
          >
            <X className="size-4" />
          </IconButton>
        </form>
      ) : (
        <>
          <span className={type.active ? 'flex-1 text-sm text-fg' : 'flex-1 text-sm text-subtle line-through'}>{type.name}</span>
          {!type.active && <Badge>inaktiv</Badge>}
          <IconButton label="Umbenennen" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
          </IconButton>
          <Button size="sm" variant="ghost" onClick={() => submit({ active: !type.active })}>
            {type.active ? 'Deaktivieren' : 'Aktivieren'}
          </Button>
        </>
      )}
    </li>
  );
}

function DeliverableTypes() {
  const { data = [] } = useDeliverableTypes();
  const save = useSaveDeliverableType();
  const toast = useToast();
  const [name, setName] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await save.mutateAsync({ name });
      setName('');
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card title="Leistungsarten">
      <p className="mb-3 text-sm text-muted">
        Grundlage für Pakete und Projekte, z. B. Reel oder Imagefilm. Deaktivierte Arten bleiben in bestehenden Paketen
        erhalten, werden aber nicht mehr zur Auswahl angeboten.
      </p>
      <ul className="divide-y divide-line">
        {data.map((t) => (
          <DeliverableTypeRow key={t.id} type={t} />
        ))}
      </ul>
      <form onSubmit={add} className="mt-3 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Neue Leistungsart" aria-label="Neue Leistungsart" />
        <Button type="submit" icon={<Plus className="size-4" />} loading={save.isPending} disabled={!name.trim()}>
          Hinzufügen
        </Button>
      </form>
    </Card>
  );
}

function TeamRow({ member }: { member: TeamMember }) {
  const save = useSaveTeamMember();
  const toast = useToast();
  async function toggle() {
    try {
      await save.mutateAsync({
        id: member.id,
        name: member.name,
        email: member.email,
        color: member.color,
        weekly_capacity_h: member.weekly_capacity_h,
        active: !member.active,
      });
    } catch (err) {
      toast.error(err);
    }
  }
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="size-3 rounded-full" style={{ background: member.color }} />
      <div className="min-w-0 flex-1">
        <div className={member.active ? 'text-sm text-fg' : 'text-sm text-subtle'}>{member.name}</div>
        {member.email && <div className="truncate text-xs text-muted">{member.email}</div>}
      </div>
      {!member.active && <Badge>inaktiv</Badge>}
      <Button size="sm" variant="ghost" onClick={toggle}>
        {member.active ? 'Deaktivieren' : 'Aktivieren'}
      </Button>
    </li>
  );
}

function Team() {
  const { data = [] } = useTeam();
  const save = useSaveTeamMember();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [color, setColor] = useState('#2f54c9');

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({ name, email: email || null, color, weekly_capacity_h: null });
      setName('');
      setEmail('');
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card title="Team und Freelancer">
      <p className="mb-3 text-sm text-muted">
        Optional. Wenn du allein arbeitest, kannst du diesen Bereich leer lassen. Hier eingetragene Personen (z. B.
        freie Cutter) lassen sich später Phasen und Aufgaben als Verantwortliche zuordnen.
      </p>
      {data.length > 0 && (
        <ul className="mb-3 divide-y divide-line">
          {data.map((m) => (
            <TeamRow key={m.id} member={m} />
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" />
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail (optional)" aria-label="E-Mail" type="email" />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Farbe"
          className="h-9 w-12 cursor-pointer rounded-md border border-line-strong bg-surface p-1"
        />
        <Button type="submit" icon={<Plus className="size-4" />} loading={save.isPending} disabled={!name.trim()}>
          Hinzufügen
        </Button>
      </form>
    </Card>
  );
}

function Backups() {
  const { data, isLoading, error } = useBackups();
  const run = useRunBackup();
  const toast = useToast();

  async function backupNow() {
    try {
      const b = await run.mutateAsync();
      toast.success(`Sicherung ${b.file} erstellt`);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card
      title="Datensicherung"
      actions={
        <Button size="sm" icon={<HardDrive className="size-4" />} onClick={backupNow} loading={run.isPending}>
          Jetzt sichern
        </Button>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : data ? (
        <div className="grid gap-4 text-sm">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Letzte Sicherung</dt>
            <dd className="text-fg">{data.last_backup_at ? formatDateTime(data.last_backup_at) : 'Noch keine'}</dd>
            <dt className="text-muted">Speicherort</dt>
            <dd className="break-all text-fg">{data.directory}</dd>
            <dt className="text-muted">Zweiter Speicherort</dt>
            <dd className="break-all text-fg">{data.extra_directory || <span className="text-subtle">nicht eingerichtet (BACKUP_EXTRA_DIR in der .env)</span>}</dd>
            <dt className="text-muted">Aufbewahrung</dt>
            <dd className="text-fg">
              {data.keep_days} Tage täglich, danach eine Sicherung je Monat für 12 Monate
            </dd>
          </dl>
          {data.last_error && (
            <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
              Letzter Fehler: {data.last_error}
            </div>
          )}
          <p className="text-xs text-subtle">
            Automatisch einmal täglich um 02:30 Uhr. War der Rechner zu dieser Zeit aus, wird die Sicherung kurz nach dem
            nächsten Start nachgeholt.
          </p>
          {data.backups.length > 0 && (
            <div className="overflow-hidden rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Datei</th>
                    <th className="px-3 py-2 font-medium">Erstellt</th>
                    <th className="px-3 py-2 text-right font-medium">Größe</th>
                  </tr>
                </thead>
                <tbody>
                  {data.backups.slice(0, 10).map((b) => (
                    <tr key={b.file} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-mono text-xs break-all">{b.file}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted">{formatDateTime(b.created_at)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-muted tabular">{formatBytes(b.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.backups.length > 10 && (
                <p className="border-t border-line px-3 py-2 text-xs text-subtle">
                  und {data.backups.length - 10} ältere Sicherungen
                </p>
              )}
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Einstellungen" />
      <div className="grid gap-5">
        <GeneralSettings />
        <GoogleSettings />
        <div className="grid gap-5 lg:grid-cols-2">
          <DeliverableTypes />
          <Team />
        </div>
        <Backups />
      </div>
    </>
  );
}
