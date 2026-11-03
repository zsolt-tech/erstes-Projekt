// Kunden anlegen und bearbeiten.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Star, Trash2 } from 'lucide-react';
import { ApiError } from '../api/client';
import { useCustomer, useDeliverableTypes, useSaveCustomer, useSettings } from '../api/hooks';
import { Button, Card, ErrorBox, Field, IconButton, Input, PageHeader, Select, Spinner, Textarea, cx } from '../components/ui';
import { useToast } from '../components/feedback';
import { centsToInput, inputToCents, today } from '../lib/format';
import { useSingleFlight } from '../lib/singleFlight';
import { useUnsavedChanges } from '../lib/unsaved';
import {
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABELS,
  PIPELINE_STAGES,
  PIPELINE_STAGE_LABELS,
  PLATFORMS,
  PLATFORM_LABELS,
  QA_PROFILES,
  QA_PROFILE_BY_TYPE,
  QA_PROFILE_LABELS,
  type QaProfile,
  type Customer,
  type CustomerInput,
  type CustomerStatus,
  type CustomerType,
  type PipelineStage,
  type Platform,
} from '../../../shared/schemas';

let keySeq = 0;
const newKey = () => `n${++keySeq}`;

interface ContactRow {
  key: string;
  id?: number;
  name: string;
  role: string;
  phone: string;
  email: string;
  is_primary: boolean;
}
interface ChannelRow {
  key: string;
  id?: number;
  platform: Platform;
  handle: string;
  url: string;
}
interface PackageRow {
  key: string;
  id?: number;
  deliverable_type_id: string;
  quantity_per_month: string;
  price: string;
  valid_from: string;
  valid_until: string;
}
interface FormState {
  company_name: string;
  industry: string;
  customer_type: CustomerType;
  status: CustomerStatus;
  pipeline_stage: PipelineStage;
  lead_source: string;
  next_contact_date: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
  website: string;
  notes: string;
  approval_reminder_days: string;
  qa_profile: QaProfile | '';
  qa_motion_required: boolean;
  qa_notes: string;
  contacts: ContactRow[];
  social_channels: ChannelRow[];
  package_items: PackageRow[];
}

const firstOfMonth = () => `${today().slice(0, 7)}-01`;

const emptyContact = (primary = false): ContactRow => ({
  key: newKey(),
  name: '',
  role: '',
  phone: '',
  email: '',
  is_primary: primary,
});

function emptyForm(): FormState {
  return {
    company_name: '',
    industry: '',
    customer_type: 'sonstige',
    status: 'aktiv',
    pipeline_stage: 'erstkontakt',
    lead_source: '',
    next_contact_date: '',
    street: '',
    postal_code: '',
    city: '',
    country: 'Deutschland',
    website: '',
    notes: '',
    approval_reminder_days: '',
    qa_profile: '',
    qa_motion_required: false,
    qa_notes: '',
    contacts: [emptyContact(true)],
    social_channels: [],
    package_items: [],
  };
}

function fromCustomer(c: Customer): FormState {
  const s = (v: string | null) => v ?? '';
  return {
    company_name: c.company_name,
    industry: s(c.industry),
    customer_type: c.customer_type,
    status: c.status,
    pipeline_stage: c.pipeline_stage && c.status === 'interessent' ? c.pipeline_stage : 'erstkontakt',
    lead_source: s(c.lead_source),
    next_contact_date: s(c.next_contact_date),
    street: s(c.street),
    postal_code: s(c.postal_code),
    city: s(c.city),
    country: s(c.country),
    website: s(c.website),
    notes: s(c.notes),
    approval_reminder_days: c.approval_reminder_days ? String(c.approval_reminder_days) : '',
    qa_profile: c.qa_profile ?? '',
    qa_motion_required: !!c.qa_motion_required,
    qa_notes: s(c.qa_notes),
    contacts: c.contacts.map((x) => ({
      key: newKey(),
      id: x.id,
      name: x.name,
      role: s(x.role),
      phone: s(x.phone),
      email: s(x.email),
      is_primary: !!x.is_primary,
    })),
    social_channels: c.social_channels.map((x) => ({
      key: newKey(),
      id: x.id,
      platform: x.platform,
      handle: s(x.handle),
      url: s(x.url),
    })),
    package_items: c.package_items.map((x) => ({
      key: newKey(),
      id: x.id,
      deliverable_type_id: String(x.deliverable_type_id),
      quantity_per_month: String(x.quantity_per_month),
      price: centsToInput(x.monthly_price_cents),
      valid_from: x.valid_from,
      valid_until: s(x.valid_until),
    })),
  };
}

function toInput(f: FormState): { data: CustomerInput; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const package_items = f.package_items.map((p, i) => {
    const cents = inputToCents(p.price);
    if (Number.isNaN(cents)) errors[`package_items.${i}.monthly_price_cents`] = 'Ungültiger Betrag, z. B. 890,00';
    return {
      id: p.id,
      deliverable_type_id: Number(p.deliverable_type_id) || (NaN as number),
      quantity_per_month: p.quantity_per_month.trim() === '' ? (NaN as number) : Number(p.quantity_per_month),
      monthly_price_cents: Number.isNaN(cents) ? null : cents,
      valid_from: p.valid_from,
      valid_until: p.valid_until || null,
    };
  });
  const days = f.approval_reminder_days.trim();
  return {
    errors,
    data: {
      company_name: f.company_name,
      industry: f.industry,
      customer_type: f.customer_type,
      status: f.status,
      pipeline_stage: f.status === 'interessent' ? f.pipeline_stage : null,
      lead_source: f.lead_source,
      next_contact_date: f.next_contact_date || null,
      street: f.street,
      postal_code: f.postal_code,
      city: f.city,
      country: f.country,
      website: f.website,
      notes: f.notes,
      approval_reminder_days: days ? Number(days) : null,
      qa_profile: f.qa_profile || null,
      qa_motion_required: f.qa_motion_required,
      qa_notes: f.qa_notes,
      contacts: f.contacts.map(({ id, name, role, phone, email, is_primary }) => ({ id, name, role, phone, email, is_primary })),
      social_channels: f.social_channels.map(({ id, platform, handle, url }) => ({ id, platform, handle, url })),
      package_items,
    },
  };
}

export function CustomerFormPage() {
  const { id: idParam } = useParams();
  const id = idParam ? Number(idParam) : undefined;
  const isEdit = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const { data: customer, isLoading, error } = useCustomer(id);
  const { data: types = [] } = useDeliverableTypes();
  const { data: settings } = useSettings();
  const save = useSaveCustomer();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const initialized = useRef(false);
  // Stand beim Öffnen: Speichern scheitert mit Hinweis, wenn der Kunde inzwischen woanders geändert wurde
  const loadedVersion = useRef<string | undefined>(undefined);
  const once = useSingleFlight();

  useEffect(() => {
    if (isEdit && customer && !initialized.current) {
      setForm(fromCustomer(customer));
      loadedVersion.current = customer.updated_at;
      initialized.current = true;
    }
  }, [isEdit, customer]);

  useUnsavedChanges(dirty);

  const activeTypes = useMemo(() => types.filter((t) => t.active), [types]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function updateRow<K extends 'contacts' | 'social_channels' | 'package_items'>(
    key: K,
    index: number,
    patch: Partial<FormState[K][number]>,
  ) {
    setForm((f) => ({
      ...f,
      [key]: (f[key] as FormState[K][number][]).map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
    setDirty(true);
  }

  function removeRow(key: 'contacts' | 'social_channels' | 'package_items', index: number) {
    setForm((f) => {
      const rows = (f[key] as { is_primary?: boolean }[]).filter((_, i) => i !== index);
      // Wird der Hauptkontakt entfernt, übernimmt der nächste
      if (key === 'contacts' && rows.length && !rows.some((r) => r.is_primary)) rows[0] = { ...rows[0], is_primary: true };
      return { ...f, [key]: rows };
    });
    setErrors({});
    setDirty(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Komplett leere Ansprechpartner-Zeilen werden nicht mitgesendet; die Formularzeilen bleiben unverändert
    const isEmpty = (c: ContactRow) => !(c.name.trim() || c.phone.trim() || c.email.trim() || c.role.trim());
    const sentContactIndex = form.contacts.map((c, i) => (isEmpty(c) ? -1 : i)).filter((i) => i >= 0);
    const { data, errors: clientErrors } = toInput({ ...form, contacts: form.contacts.filter((c) => !isEmpty(c)) });
    // Fehlermeldungen des Servers ("contacts.0.email") auf die Zeile im Formular zurückführen
    const mapErrors = (fields: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(fields).map(([key, msg]) => {
          const m = /^contacts\.(\d+)\.(.+)$/.exec(key);
          return [m ? `contacts.${sentContactIndex[Number(m[1])]}.${m[2]}` : key, msg];
        }),
      );
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      toast.error('Bitte die markierten Felder prüfen.');
      return;
    }
    await once(async () => {
    try {
      const saved = await save.mutateAsync({ id, data, expectedUpdatedAt: loadedVersion.current });
      setDirty(false);
      toast.success(isEdit ? 'Änderungen gespeichert' : 'Kunde angelegt');
      navigate(`/kunden/${saved.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrors(mapErrors(err.fields));
        toast.error('Bitte die markierten Felder prüfen.');
      } else {
        toast.error(err);
      }
    }
    });
  }

  if (isEdit && isLoading) return <Spinner />;
  if (isEdit && error) return <ErrorBox error={error} />;

  const err = (key: string) => errors[key];
  const cancelTarget = isEdit ? `/kunden/${id}` : '/kunden';

  return (
    <form onSubmit={onSubmit} noValidate className="pb-24">
      <PageHeader
        back={
          <Link to={cancelTarget} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
            <ArrowLeft className="size-3.5" />
            {isEdit ? customer?.company_name : 'Kunden'}
          </Link>
        }
        title={isEdit ? 'Kunde bearbeiten' : 'Neuer Kunde'}
      />

      <div className="grid gap-5">
        <Card title="Stammdaten">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Firmenname" required error={err('company_name')} className="sm:col-span-2">
              <Input
                value={form.company_name}
                onChange={(e) => update('company_name', e.target.value)}
                invalid={!!err('company_name')}
                autoFocus={!isEdit}
              />
            </Field>
            <Field label="Branche" error={err('industry')}>
              <Input
                value={form.industry}
                onChange={(e) => update('industry', e.target.value)}
                placeholder="z. B. Italienische Gastronomie"
              />
            </Field>
            <Field label="Kundentyp" hint="Bestimmt die passende Projektvorlage">
              <Select value={form.customer_type} onChange={(e) => update('customer_type', e.target.value as CustomerType)}>
                {CUSTOMER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CUSTOMER_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => update('status', e.target.value as CustomerStatus)}>
                {CUSTOMER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CUSTOMER_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Website" error={err('website')}>
              <Input value={form.website} onChange={(e) => update('website', e.target.value)} placeholder="www.beispiel.de" />
            </Field>
            {form.status === 'interessent' && (
              <>
                <Field label="Akquise-Stufe">
                  <Select
                    value={form.pipeline_stage}
                    onChange={(e) => update('pipeline_stage', e.target.value as PipelineStage)}
                  >
                    {PIPELINE_STAGES.filter((s) => s !== 'gewonnen').map((s) => (
                      <option key={s} value={s}>
                        {PIPELINE_STAGE_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Nächster Kontakt" error={err('next_contact_date')}>
                  <Input
                    type="date"
                    value={form.next_contact_date}
                    onChange={(e) => update('next_contact_date', e.target.value)}
                  />
                </Field>
                <Field label="Quelle" className="sm:col-span-2">
                  <Input
                    value={form.lead_source}
                    onChange={(e) => update('lead_source', e.target.value)}
                    placeholder="z. B. Empfehlung, Instagram, Messe"
                  />
                </Field>
              </>
            )}
          </div>
        </Card>

        <Card title="Adresse">
          <div className="grid gap-4 sm:grid-cols-6">
            <Field label="Straße und Hausnummer" className="sm:col-span-6">
              <Input value={form.street} onChange={(e) => update('street', e.target.value)} />
            </Field>
            <Field label="PLZ" className="sm:col-span-2">
              <Input value={form.postal_code} onChange={(e) => update('postal_code', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Ort" className="sm:col-span-4">
              <Input value={form.city} onChange={(e) => update('city', e.target.value)} />
            </Field>
            <Field label="Land" className="sm:col-span-3">
              <Input value={form.country} onChange={(e) => update('country', e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card
          title="Ansprechpartner"
          actions={
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-4" />}
              onClick={() => update('contacts', [...form.contacts, emptyContact(form.contacts.length === 0)])}
            >
              Hinzufügen
            </Button>
          }
        >
          {form.contacts.length === 0 ? (
            <p className="text-sm text-muted">Noch kein Ansprechpartner erfasst.</p>
          ) : (
            <div className="grid gap-4">
              {form.contacts.map((c, i) => (
                <div
                  key={c.key}
                  className={cx(
                    'grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]',
                    c.is_primary ? 'border-accent/40 bg-accent-soft/40' : 'border-line',
                  )}
                >
                  <Field label="Name" required error={err(`contacts.${i}.name`)}>
                    <Input
                      value={c.name}
                      onChange={(e) => updateRow('contacts', i, { name: e.target.value })}
                      invalid={!!err(`contacts.${i}.name`)}
                    />
                  </Field>
                  <Field label="Rolle">
                    <Input
                      value={c.role}
                      onChange={(e) => updateRow('contacts', i, { role: e.target.value })}
                      placeholder="z. B. Inhaber"
                    />
                  </Field>
                  <Field label="Telefon">
                    <Input
                      value={c.phone}
                      type="tel"
                      onChange={(e) => updateRow('contacts', i, { phone: e.target.value })}
                    />
                  </Field>
                  <Field label="E-Mail" error={err(`contacts.${i}.email`)}>
                    <Input
                      value={c.email}
                      type="email"
                      onChange={(e) => updateRow('contacts', i, { email: e.target.value })}
                      invalid={!!err(`contacts.${i}.email`)}
                    />
                  </Field>
                  <div className="flex items-end gap-1 pb-0.5">
                    <IconButton
                      label={c.is_primary ? 'Hauptansprechpartner' : 'Als Hauptansprechpartner festlegen'}
                      onClick={() => {
                        setForm((f) => ({
                          ...f,
                          contacts: f.contacts.map((x, j) => ({ ...x, is_primary: j === i })),
                        }));
                        setDirty(true);
                      }}
                      className={c.is_primary ? 'text-accent' : undefined}
                    >
                      <Star className="size-4" fill={c.is_primary ? 'currentColor' : 'none'} />
                    </IconButton>
                    <IconButton label="Ansprechpartner entfernen" onClick={() => removeRow('contacts', i)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Social-Media-Kanäle"
          actions={
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-4" />}
              onClick={() =>
                update('social_channels', [
                  ...form.social_channels,
                  { key: newKey(), platform: 'instagram', handle: '', url: '' },
                ])
              }
            >
              Hinzufügen
            </Button>
          }
        >
          {form.social_channels.length === 0 ? (
            <p className="text-sm text-muted">Noch keine Kanäle erfasst.</p>
          ) : (
            <div className="grid gap-3">
              {form.social_channels.map((s, i) => (
                <div key={s.key} className="grid gap-3 sm:grid-cols-[200px_1fr_1.5fr_auto]">
                  <Field label="Plattform">
                    <Select
                      value={s.platform}
                      onChange={(e) => updateRow('social_channels', i, { platform: e.target.value as Platform })}
                    >
                      {PLATFORMS.map((p) => (
                        <option key={p} value={p}>
                          {PLATFORM_LABELS[p]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Profilname" error={err(`social_channels.${i}.handle`)}>
                    <Input
                      value={s.handle}
                      onChange={(e) => updateRow('social_channels', i, { handle: e.target.value })}
                      placeholder="@profil"
                      invalid={!!err(`social_channels.${i}.handle`)}
                    />
                  </Field>
                  <Field label="Link">
                    <Input
                      value={s.url}
                      onChange={(e) => updateRow('social_channels', i, { url: e.target.value })}
                      placeholder="instagram.com/profil"
                    />
                  </Field>
                  <div className="flex items-end pb-0.5">
                    <IconButton label="Kanal entfernen" onClick={() => removeRow('social_channels', i)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Gebuchtes Paket"
          actions={
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-4" />}
              disabled={activeTypes.length === 0}
              onClick={() =>
                update('package_items', [
                  ...form.package_items,
                  {
                    key: newKey(),
                    deliverable_type_id: String(activeTypes[0]?.id ?? ''),
                    quantity_per_month: '',
                    price: '',
                    valid_from: firstOfMonth(),
                    valid_until: '',
                  },
                ])
              }
            >
              Leistung hinzufügen
            </Button>
          }
        >
          {form.package_items.length === 0 ? (
            <p className="text-sm text-muted">
              Kein Paket gebucht. Füge Leistungen hinzu, z. B. 4 Reels pro Monat. Der Verbrauch wird im laufenden
              Monat automatisch mitgezählt.
            </p>
          ) : (
            <div className="grid gap-3">
              {form.package_items.map((p, i) => (
                <div key={p.key} className="grid gap-3 sm:grid-cols-[1.4fr_0.8fr_1fr_1fr_1fr_auto]">
                  <Field label="Leistung" error={err(`package_items.${i}.deliverable_type_id`)}>
                    <Select
                      value={p.deliverable_type_id}
                      onChange={(e) => updateRow('package_items', i, { deliverable_type_id: e.target.value })}
                    >
                      {types
                        .filter((t) => t.active || String(t.id) === p.deliverable_type_id)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <Field label="Pro Monat" required error={err(`package_items.${i}.quantity_per_month`)}>
                    <Input
                      value={p.quantity_per_month}
                      type="number"
                      min={1}
                      onChange={(e) => updateRow('package_items', i, { quantity_per_month: e.target.value })}
                      invalid={!!err(`package_items.${i}.quantity_per_month`)}
                    />
                  </Field>
                  <Field label="Preis pro Monat (EUR)" error={err(`package_items.${i}.monthly_price_cents`)}>
                    <Input
                      value={p.price}
                      inputMode="decimal"
                      placeholder="optional"
                      onChange={(e) => updateRow('package_items', i, { price: e.target.value })}
                      invalid={!!err(`package_items.${i}.monthly_price_cents`)}
                    />
                  </Field>
                  <Field label="Gültig ab" required error={err(`package_items.${i}.valid_from`)}>
                    <Input
                      type="date"
                      value={p.valid_from}
                      onChange={(e) => updateRow('package_items', i, { valid_from: e.target.value })}
                      invalid={!!err(`package_items.${i}.valid_from`)}
                    />
                  </Field>
                  <Field label="Gültig bis" error={err(`package_items.${i}.valid_until`)}>
                    <Input
                      type="date"
                      value={p.valid_until}
                      onChange={(e) => updateRow('package_items', i, { valid_until: e.target.value })}
                      invalid={!!err(`package_items.${i}.valid_until`)}
                    />
                  </Field>
                  <div className="flex items-end pb-0.5">
                    <IconButton label="Leistung entfernen" onClick={() => removeRow('package_items', i)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Freigaben">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Erinnerung nach Tagen ohne Rückmeldung"
              error={err('approval_reminder_days')}
              hint={`Leer lassen für den Standard aus den Einstellungen (${settings?.approval_reminder_days ?? 3} Tage)`}
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
          </div>
        </Card>

        <Card title="Videoschnitt">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prüfprofil für die Clip-Qualitätsprüfung" hint="Bestimmt die Schwellen des Videoschnitt-Agenten">
              <Select value={form.qa_profile} onChange={(e) => update('qa_profile', e.target.value as QaProfile | '')}>
                <option value="">Automatisch aus dem Kundentyp ({QA_PROFILE_LABELS[QA_PROFILE_BY_TYPE[form.customer_type]]})</option>
                {QA_PROFILES.map((p) => (
                  <option key={p} value={p}>
                    {QA_PROFILE_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex cursor-pointer items-start gap-2.5 self-end pb-1 text-sm">
              <input
                type="checkbox"
                checked={form.qa_motion_required}
                onChange={(e) => update('qa_motion_required', e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--accent)]"
              />
              <span>
                Durchgehende Kamerabewegung Pflicht
                <span className="block text-xs text-muted">Kein Stillstand in B-Roll und Drohnenshots (Option „Bewegung Pflicht“)</span>
              </span>
            </label>
            <Field label="Hinweise für den Schnitt" className="sm:col-span-2" hint="Gilt für alle Videos dieses Kunden, z. B. „keine Hände im Bild“ oder „Endschnitt in Premiere, geprüfte Einzelteile liefern“">
              <Textarea value={form.qa_notes} onChange={(e) => update('qa_notes', e.target.value)} rows={3} />
            </Field>
          </div>
        </Card>

        <Card title="Notizen">
          <Textarea
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            rows={6}
            placeholder="Besonderheiten, Vorlieben, Absprachen ..."
            aria-label="Notizen"
          />
        </Card>
      </div>

      <div className="fixed right-0 bottom-0 left-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:left-56">
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-4 py-3 sm:px-6 lg:px-8">
          {dirty && <span className="mr-auto text-xs text-subtle">Ungespeicherte Änderungen</span>}
          <Button onClick={() => navigate(cancelTarget)}>Abbrechen</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {isEdit ? 'Speichern' : 'Kunde anlegen'}
          </Button>
        </div>
      </div>
    </form>
  );
}
