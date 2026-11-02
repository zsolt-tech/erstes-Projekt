// Einstellungen: Briefing, Benachrichtigungen, Freigabe-Erinnerungen und Engpass-Schwellen.
import { useEffect, useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import { ApiError } from '../api/client';
import { useSaveSettings, useSettings } from '../api/hooks';
import { useGoogleStatus } from '../api/google';
import { useGenerateBriefing } from '../api/briefing';
import { useToast } from './feedback';
import { Button, Card, Field, Input } from './ui';
import type { Settings } from '../../../shared/schemas';

function Check({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2.5 py-1 text-sm ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

function readBrowserNotify(): boolean {
  try {
    return localStorage.getItem('browser-notify') === '1';
  } catch {
    return false;
  }
}

export function BriefingSettings() {
  const { data: settings } = useSettings();
  const { data: google } = useGoogleStatus();
  const save = useSaveSettings();
  const generate = useGenerateBriefing();
  const toast = useToast();
  const [form, setForm] = useState<Pick<Settings, 'briefing_time' | 'briefing_desktop' | 'briefing_email_enabled' | 'briefing_email_to' | 'reminder_enabled' | 'reminder_email'> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [browserNotify, setBrowserNotify] = useState(readBrowserNotify);
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'denied';

  useEffect(() => {
    if (settings) {
      setForm({
        briefing_time: settings.briefing_time,
        briefing_desktop: settings.briefing_desktop,
        briefing_email_enabled: settings.briefing_email_enabled,
        briefing_email_to: settings.briefing_email_to,
        reminder_enabled: settings.reminder_enabled,
        reminder_email: settings.reminder_email,
      });
    }
  }, [settings]);

  if (!form) return null;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync(form!);
      setErrors({});
      toast.success('Gespeichert');
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      toast.error(err);
    }
  }

  async function toggleBrowser(on: boolean) {
    if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        toast.error('Der Browser hat Benachrichtigungen nicht erlaubt. Das lässt sich in den Website-Einstellungen des Browsers ändern.');
        return;
      }
    }
    try {
      localStorage.setItem('browser-notify', on ? '1' : '0');
    } catch {
      /* Speicher nicht verfügbar */
    }
    setBrowserNotify(on);
  }

  const emailPossible = !!google?.connected;
  return (
    <Card title="Briefing und Benachrichtigungen">
      <form onSubmit={submit} className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-3">
            <Field label="Briefing täglich um" error={errors.briefing_time} hint="Zeitzone Europe/Berlin. War der Rechner aus, kommt das Briefing beim nächsten Start.">
              <Input type="time" value={form.briefing_time} onChange={(e) => set('briefing_time', e.target.value)} className="w-32" invalid={!!errors.briefing_time} />
            </Field>
            <Check checked={form.briefing_desktop} onChange={(v) => set('briefing_desktop', v)} label="Desktop-Benachrichtigung" hint="Hinweis des Betriebssystems, auch wenn die App nicht im Browser offen ist" />
            <Check
              checked={browserNotify}
              onChange={toggleBrowser}
              label="Browser-Benachrichtigungen auf diesem Rechner"
              hint={permission === 'denied' ? 'Im Browser blockiert. Bitte in den Website-Einstellungen erlauben.' : 'Solange die App in einem Tab offen ist; ein Klick öffnet die App'}
            />
          </div>
          <div className="grid content-start gap-3">
            <Check
              checked={form.briefing_email_enabled}
              onChange={(v) => set('briefing_email_enabled', v)}
              disabled={!emailPossible}
              label="Briefing zusätzlich per E-Mail"
              hint={emailPossible ? 'Versand über dein verbundenes Google-Konto' : 'Dafür zuerst Google verbinden'}
            />
            {form.briefing_email_enabled && (
              <Field label="An" error={errors.briefing_email_to} hint="Leer lassen für die Adresse des Google-Kontos">
                <Input type="email" value={form.briefing_email_to} onChange={(e) => set('briefing_email_to', e.target.value)} placeholder={google?.email ?? ''} invalid={!!errors.briefing_email_to} />
              </Field>
            )}
          </div>
        </div>
        <div className="border-t border-line pt-4">
          <div className="mb-1 text-[13px] font-medium text-muted">Freigabe-Erinnerungen</div>
          <Check
            checked={form.reminder_enabled}
            onChange={(v) => set('reminder_enabled', v)}
            label="Erinnern, wenn ein Kunde nicht auf eine Freigabe reagiert"
            hint={`Nach ${settings?.approval_reminder_days ?? 3} Tagen (Standard oben, je Kunde und Projekt änderbar), danach im selben Abstand erneut. Nur zwischen 9 und 19 Uhr.`}
          />
          <Check checked={form.reminder_email} onChange={(v) => set('reminder_email', v)} disabled={!emailPossible || !form.reminder_enabled} label="Erinnerungen zusätzlich per E-Mail" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            icon={<Send className="size-4" />}
            loading={generate.isPending}
            onClick={() =>
              generate
                .mutateAsync(true)
                .then((b) => toast.success(b.emailed_at ? 'Briefing erzeugt, Benachrichtigung und E-Mail verschickt' : 'Briefing erzeugt und als Benachrichtigung verschickt'), (err) => toast.error(err))
            }
          >
            Briefing jetzt testen
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Speichern
          </Button>
        </div>
      </form>
    </Card>
  );
}

const LIMITS: { key: keyof Settings['bottleneck_limits']; label: string; unit: string }[] = [
  { key: 'editing_days', label: 'In Bearbeitung länger als', unit: 'Tage' },
  { key: 'upload_days', label: 'Im Upload länger als', unit: 'Tage' },
  { key: 'approval_days', label: 'Freigabe offen länger als', unit: 'Tage' },
  { key: 'shoots_per_week', label: 'Drehtage in 7 Tagen mehr als', unit: 'Drehtage' },
  { key: 'editing_parallel', label: 'Gleichzeitig in Bearbeitung mehr als', unit: 'Projekte' },
  { key: 'deadlines_per_day', label: 'Fristen an einem Tag ab', unit: 'Fristen' },
];

export function BottleneckSettings() {
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) setValues(Object.fromEntries(LIMITS.map((l) => [l.key, String(settings.bottleneck_limits[l.key])])));
  }, [settings]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await save.mutateAsync({
        bottleneck_limits: Object.fromEntries(LIMITS.map((l) => [l.key, Number(values[l.key])])) as Settings['bottleneck_limits'],
      });
      toast.success('Schwellen gespeichert');
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Card title="Engpass-Erkennung">
      <form onSubmit={submit} className="grid gap-4">
        <p className="text-sm text-muted">Ab diesen Werten erscheint eine Warnung im Briefing und im Dashboard.</p>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {LIMITS.map((l) => (
            <label key={l.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-fg">{l.label}</span>
              <span className="flex items-center gap-2">
                <Input type="number" min={1} value={values[l.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [l.key]: e.target.value }))} className="w-20 text-right" />
                <span className="w-16 text-xs text-muted">{l.unit}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Speichern
          </Button>
        </div>
      </form>
    </Card>
  );
}
