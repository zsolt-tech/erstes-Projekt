// Projekt anlegen und Grunddaten bearbeiten.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ApiError, api } from '../api/client';
import { useCustomers, useDeliverableTypes, useSettings } from '../api/hooks';
import { useProject, useTemplates } from '../api/projects';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui';
import { useToast } from '../components/feedback';
import { currentMonth, formatMonth } from '../lib/format';
import { useUnsavedChanges } from '../lib/unsaved';
import {
  CHECKLIST_KIND_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  type ChecklistKind,
  type Priority,
  type ProjectDetail,
} from '../../../shared/schemas';

interface FormState {
  customer_id: string;
  title: string;
  template_id: string;
  deliverable_type_id: string;
  deliverable_count: string;
  service_month: string;
  priority: Priority;
  shoot_date: string;
  start_time: string;
  end_time: string;
  location: string;
  description: string;
  notes: string;
  status: 'aktiv' | 'pausiert' | 'abgebrochen' | 'abgeschlossen';
  approval_reminder_days: string;
}

const empty = (customerId = ''): FormState => ({
  customer_id: customerId,
  title: '',
  template_id: '',
  deliverable_type_id: '',
  deliverable_count: '1',
  service_month: currentMonth(),
  priority: 'normal',
  shoot_date: '',
  start_time: '',
  end_time: '',
  location: '',
  description: '',
  notes: '',
  status: 'aktiv',
  approval_reminder_days: '',
});

function fromProject(p: ProjectDetail): FormState {
  return {
    ...empty(String(p.customer_id)),
    title: p.title,
    deliverable_type_id: p.deliverable_type_id ? String(p.deliverable_type_id) : '',
    deliverable_count: String(p.deliverable_count),
    service_month: p.service_month,
    priority: p.priority,
    description: p.description ?? '',
    notes: p.notes ?? '',
    status: p.status,
    approval_reminder_days: p.approval_reminder_days ? String(p.approval_reminder_days) : '',
  };
}

export function ProjectFormPage() {
  const { id: idParam } = useParams();
  const id = idParam ? Number(idParam) : undefined;
  const isEdit = !!id;
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: project, isLoading, error } = useProject(id);
  const { data: customers = [] } = useCustomers({});
  const { data: templates = [] } = useTemplates();
  const { data: types = [] } = useDeliverableTypes();
  const { data: settings } = useSettings();

  const [form, setForm] = useState<FormState>(() => empty(search.get('kunde') ?? ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const touched = useRef<Set<keyof FormState>>(new Set());
  const initialized = useRef(false);

  useEffect(() => {
    if (isEdit && project && !initialized.current) {
      setForm(fromProject(project));
      initialized.current = true;
    }
  }, [isEdit, project]);

  const customer = customers.find((c) => String(c.id) === form.customer_id);

  // Vorlage passend zum Kundentyp vorschlagen, Leistung und Anzahl daraus übernehmen
  useEffect(() => {
    if (isEdit || !templates.length) return;
    const suggested =
      templates.find((t) => customer && t.customer_type === customer.customer_type) ?? templates.find((t) => !t.customer_type);
    if (!suggested) return;
    setForm((f) => {
      const next = { ...f };
      if (!touched.current.has('template_id')) next.template_id = String(suggested.id);
      const tpl = templates.find((t) => String(t.id) === next.template_id);
      if (tpl) {
        if (!touched.current.has('deliverable_type_id') && tpl.deliverable_type_id) next.deliverable_type_id = String(tpl.deliverable_type_id);
        if (!touched.current.has('deliverable_count')) next.deliverable_count = String(tpl.default_deliverable_count);
      }
      return next;
    });
  }, [isEdit, templates, customer?.id, form.template_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leistungsmonat folgt dem Drehdatum, solange er nicht von Hand geändert wurde
  useEffect(() => {
    if (!isEdit && form.shoot_date && !touched.current.has('service_month')) {
      setForm((f) => ({ ...f, service_month: f.shoot_date.slice(0, 7) }));
    }
  }, [isEdit, form.shoot_date]);

  const template = templates.find((t) => String(t.id) === form.template_id);
  const templateSummary = useMemo(() => {
    if (!template) return null;
    const counts: Partial<Record<ChecklistKind, number>> = {};
    for (const i of template.items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
    return (Object.keys(counts) as ChecklistKind[]).map((k) => `${counts[k]} ${CHECKLIST_KIND_LABELS[k]}`).join(', ');
  }, [template]);

  const typeName = types.find((t) => String(t.id) === form.deliverable_type_id)?.name;
  const titleSuggestion = typeName ? `${typeName} · ${formatMonth(form.service_month || currentMonth())}` : 'z. B. Reels November';

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    touched.current.add(key);
    setDirty(true);
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const title = form.title.trim() || (typeName ? titleSuggestion : '');
    const count = Number(form.deliverable_count);
    try {
      let saved: ProjectDetail;
      if (isEdit) {
        saved = await api.put<ProjectDetail>(`/projects/${id}`, {
          title,
          description: form.description,
          deliverable_type_id: form.deliverable_type_id ? Number(form.deliverable_type_id) : null,
          deliverable_count: form.deliverable_count === '' ? NaN : count,
          service_month: form.service_month,
          priority: form.priority,
          // Abgeschlossene Projekte bleiben abgeschlossen, solange der Status nicht ausdrücklich geändert wird
          ...(form.status !== 'abgeschlossen' ? { status: form.status } : {}),
          approval_reminder_days: form.approval_reminder_days ? Number(form.approval_reminder_days) : null,
          notes: form.notes,
        });
      } else {
        saved = await api.post<ProjectDetail>('/projects', {
          customer_id: form.customer_id ? Number(form.customer_id) : NaN,
          title,
          template_id: form.template_id ? Number(form.template_id) : null,
          deliverable_type_id: form.deliverable_type_id ? Number(form.deliverable_type_id) : null,
          deliverable_count: form.deliverable_count === '' ? null : count,
          service_month: form.service_month || null,
          priority: form.priority,
          shoot_date: form.shoot_date || null,
          start_time: form.start_time || null,
          end_time: form.end_time || null,
          location: form.location,
          description: form.description,
          notes: form.notes,
        });
      }
      qc.setQueryData(['projects', 'detail', saved.id], saved);
      qc.invalidateQueries({ queryKey: ['projects', 'list'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success(isEdit ? 'Änderungen gespeichert' : 'Projekt angelegt');
      setDirty(false);
      navigate(`/projekte/${saved.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrors(err.fields);
        toast.error('Bitte die markierten Felder prüfen.');
      } else {
        toast.error(err);
      }
    } finally {
      setSaving(false);
    }
  }

  if (isEdit && isLoading) return <Spinner />;
  if (isEdit && error) return <ErrorBox error={error} />;

  const back = isEdit ? `/projekte/${id}` : form.customer_id && search.get('kunde') ? `/kunden/${form.customer_id}` : '/projekte';
  const err = (k: string) => errors[k];
  const selectableCustomers = customers.filter((c) => !c.archived_at);

  return (
    <form onSubmit={onSubmit} noValidate className="pb-24">
      <PageHeader
        back={
          <Link to={back} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
            <ArrowLeft className="size-3.5" />
            Zurück
          </Link>
        }
        title={isEdit ? 'Projekt bearbeiten' : 'Neues Projekt'}
        subtitle={isEdit ? project?.customer_name : undefined}
      />

      <div className="grid gap-5">
        <Card title="Projekt">
          <div className="grid gap-4 sm:grid-cols-2">
            {!isEdit && (
              <Field label="Kunde" required error={err('customer_id')}>
                <Select
                  value={form.customer_id}
                  onChange={(e) => update('customer_id', e.target.value)}
                  invalid={!!err('customer_id')}
                  autoFocus={!form.customer_id}
                >
                  <option value="">Kunde auswählen</option>
                  {selectableCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company_name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Titel" error={err('title')} hint={!form.title ? `Leer lassen für „${titleSuggestion}“` : undefined} className={isEdit ? 'sm:col-span-2' : undefined}>
              <Input value={form.title} onChange={(e) => update('title', e.target.value)} placeholder={titleSuggestion} invalid={!!err('title')} />
            </Field>
            {!isEdit && (
              <Field label="Vorlage" hint={template ? `${template.description ?? ''}${templateSummary ? ` · ${templateSummary}` : ''}` : undefined} className="sm:col-span-2">
                <Select value={form.template_id} onChange={(e) => update('template_id', e.target.value)}>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Leistung" hint="Zählt für das gebuchte Paket">
              <Select value={form.deliverable_type_id} onChange={(e) => update('deliverable_type_id', e.target.value)}>
                <option value="">Keine Zuordnung</option>
                {types
                  .filter((t) => t.active || String(t.id) === form.deliverable_type_id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Anzahl" error={err('deliverable_count')}>
                <Input
                  type="number"
                  min={1}
                  value={form.deliverable_count}
                  onChange={(e) => update('deliverable_count', e.target.value)}
                  invalid={!!err('deliverable_count')}
                />
              </Field>
              <Field label="Leistungsmonat" error={err('service_month')}>
                <Input type="month" value={form.service_month} onChange={(e) => update('service_month', e.target.value)} invalid={!!err('service_month')} />
              </Field>
            </div>
            <Field label="Priorität">
              <Select value={form.priority} onChange={(e) => update('priority', e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            {isEdit && (
              <Field label="Status" hint={project?.status === 'abgeschlossen' ? 'Ein anderer Status öffnet das abgeschlossene Projekt wieder.' : undefined}>
                <Select value={form.status} onChange={(e) => update('status', e.target.value as FormState['status'])}>
                  {project?.status === 'abgeschlossen' && <option value="abgeschlossen">Abgeschlossen</option>}
                  <option value="aktiv">Aktiv</option>
                  <option value="pausiert">Pausiert</option>
                  <option value="abgebrochen">Abgebrochen (zählt nicht mehr für das Paket)</option>
                </Select>
              </Field>
            )}
          </div>
        </Card>

        {!isEdit && (
          <Card title="Drehtag">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Datum" error={err('shoot_date')}>
                <Input type="date" value={form.shoot_date} onChange={(e) => update('shoot_date', e.target.value)} />
              </Field>
              <Field label="Von">
                <Input type="time" value={form.start_time} onChange={(e) => update('start_time', e.target.value)} />
              </Field>
              <Field label="Bis">
                <Input type="time" value={form.end_time} onChange={(e) => update('end_time', e.target.value)} />
              </Field>
              <Field label="Ort" className="sm:col-span-4">
                <Input value={form.location} onChange={(e) => update('location', e.target.value)} placeholder="Adresse oder Treffpunkt" />
              </Field>
            </div>
            <p className="mt-3 text-xs text-subtle">
              Mit Drehdatum werden die Fälligkeiten aller Phasen aus der Vorlage berechnet. Die Daten lassen sich jederzeit anpassen.
            </p>
          </Card>
        )}

        {isEdit && (
          <Card title="Freigabe">
            <Field
              label="Erinnerung nach Tagen ohne Rückmeldung"
              error={err('approval_reminder_days')}
              hint={`Leer lassen für den Standard (Kunde oder Einstellungen, derzeit ${project?.effective_reminder_days ?? settings?.approval_reminder_days ?? 3} Tage)`}
              className="sm:max-w-sm"
            >
              <Input
                type="number"
                min={1}
                max={60}
                value={form.approval_reminder_days}
                onChange={(e) => update('approval_reminder_days', e.target.value)}
                invalid={!!err('approval_reminder_days')}
              />
            </Field>
          </Card>
        )}

        <Card title="Beschreibung und Notizen">
          <div className="grid gap-4">
            <Field label="Beschreibung">
              <Textarea value={form.description} onChange={(e) => update('description', e.target.value)} rows={3} placeholder="Ziel, Inhalte, Besonderheiten" />
            </Field>
            <Field label="Notizen">
              <Textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} rows={4} />
            </Field>
          </div>
        </Card>
      </div>

      <div className="fixed right-0 bottom-0 left-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:left-56">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <Button onClick={() => navigate(back)}>Abbrechen</Button>
          <Button type="submit" variant="primary" loading={saving}>
            {isEdit ? 'Speichern' : 'Projekt anlegen'}
          </Button>
        </div>
      </div>
    </form>
  );
}
