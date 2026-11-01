// Gemeinsame Datentypen, Bezeichnungen und Prüfregeln für Server und Oberfläche.
import { z } from 'zod';

// ---------------------------------------------------------------------
// Aufzählungen mit deutschen Bezeichnungen
// ---------------------------------------------------------------------

export const CUSTOMER_TYPES = ['restaurant', 'handwerk', 'arztpraxis', 'fahrschule', 'sonstige'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  restaurant: 'Restaurant / Gastronomie',
  handwerk: 'Handwerk',
  arztpraxis: 'Arztpraxis',
  fahrschule: 'Fahrschule',
  sonstige: 'Sonstige',
};

export const CUSTOMER_STATUSES = ['interessent', 'aktiv', 'pausiert', 'beendet'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  interessent: 'Interessent',
  aktiv: 'Aktiver Kunde',
  pausiert: 'Pausiert',
  beendet: 'Beendet',
};

export const PIPELINE_STAGES = ['erstkontakt', 'termin', 'angebot', 'gewonnen', 'verloren'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  erstkontakt: 'Erstkontakt',
  termin: 'Termin',
  angebot: 'Angebot',
  gewonnen: 'Gewonnen',
  verloren: 'Verloren',
};

export const PLATFORMS = [
  'instagram',
  'tiktok',
  'facebook',
  'youtube',
  'linkedin',
  'pinterest',
  'google_business',
  'x',
  'sonstige',
] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  google_business: 'Google Unternehmensprofil',
  x: 'X',
  sonstige: 'Sonstige',
};

export const THEMES = ['system', 'hell', 'dunkel'] as const;
export type Theme = (typeof THEMES)[number];

// ---------------------------------------------------------------------
// Hilfsregeln
// ---------------------------------------------------------------------

/** Optionaler Text: leere Eingaben werden zu null. */
const optText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Maximal ${max} Zeichen`)
    .nullish()
    .transform((v) => (v ? v : null));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT erwartet');

const optDate = z
  .union([isoDate, z.literal('')])
  .nullish()
  .transform((v) => (v ? v : null));

const optEmail = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Ungültige E-Mail-Adresse');

/** Website ohne http(s):// wird um https:// ergänzt. */
const optUrl = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => {
    if (!v) return null;
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  });

const id = z.number().int().positive();

// ---------------------------------------------------------------------
// Kunden
// ---------------------------------------------------------------------

export const contactInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, 'Name des Ansprechpartners fehlt').max(200),
  role: optText(200),
  phone: optText(100),
  email: optEmail,
  is_primary: z.boolean().default(false),
});
export type ContactInput = z.input<typeof contactInput>;

export const socialChannelInput = z
  .object({
    id: id.optional(),
    platform: z.enum(PLATFORMS, { errorMap: () => ({ message: 'Plattform auswählen' }) }),
    handle: optText(200),
    url: optUrl,
  })
  .refine((c) => c.handle || c.url, { message: 'Profilname oder Link angeben', path: ['handle'] });
export type SocialChannelInput = z.input<typeof socialChannelInput>;

export const packageItemInput = z
  .object({
    id: id.optional(),
    deliverable_type_id: z.number({ invalid_type_error: 'Leistungsart auswählen' }).int().positive('Leistungsart auswählen'),
    quantity_per_month: z
      .number({ invalid_type_error: 'Anzahl pro Monat angeben' })
      .int('Ganze Zahl erwartet')
      .min(1, 'Mindestens 1 pro Monat')
      .max(999),
    monthly_price_cents: z.number().int().min(0).nullish().transform((v) => v ?? null),
    valid_from: isoDate,
    valid_until: optDate,
  })
  .refine((p) => !p.valid_until || p.valid_until >= p.valid_from, {
    message: 'Ende liegt vor dem Beginn',
    path: ['valid_until'],
  });
export type PackageItemInput = z.input<typeof packageItemInput>;

export const customerInput = z.object({
  company_name: z.string().trim().min(1, 'Firmenname fehlt').max(200),
  industry: optText(200),
  customer_type: z.enum(CUSTOMER_TYPES).default('sonstige'),
  status: z.enum(CUSTOMER_STATUSES).default('aktiv'),
  pipeline_stage: z.enum(PIPELINE_STAGES).nullish().transform((v) => v ?? null),
  lead_source: optText(200),
  next_contact_date: optDate,
  street: optText(200),
  postal_code: optText(20),
  city: optText(100),
  country: optText(100),
  website: optUrl,
  notes: optText(20000),
  approval_reminder_days: z
    .number()
    .int()
    .min(1, 'Mindestens 1 Tag')
    .max(60, 'Höchstens 60 Tage')
    .nullish()
    .transform((v) => v ?? null),
  contacts: z.array(contactInput).max(50).default([]),
  social_channels: z.array(socialChannelInput).max(50).default([]),
  package_items: z.array(packageItemInput).max(50).default([]),
});
export type CustomerInput = z.input<typeof customerInput>;
export type CustomerData = z.output<typeof customerInput>;

// Antworttypen der API
export interface Contact {
  id: number;
  customer_id: number;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  is_primary: number;
  sort_order: number;
}

export interface SocialChannel {
  id: number;
  customer_id: number;
  platform: Platform;
  handle: string | null;
  url: string | null;
}

export interface PackageItem {
  id: number;
  customer_id: number;
  deliverable_type_id: number;
  deliverable_type_name: string;
  quantity_per_month: number;
  monthly_price_cents: number | null;
  valid_from: string;
  valid_until: string | null;
}

export interface PackageUsage {
  deliverable_type_id: number;
  deliverable_type_name: string;
  quantity: number;
  used: number;
  completed: number;
}

export interface CustomerListItem {
  id: number;
  company_name: string;
  industry: string | null;
  customer_type: CustomerType;
  status: CustomerStatus;
  pipeline_stage: PipelineStage | null;
  city: string | null;
  archived_at: string | null;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  primary_contact_email: string | null;
  package_summary: string | null;
  updated_at: string;
}

export interface Customer {
  id: number;
  company_name: string;
  industry: string | null;
  customer_type: CustomerType;
  status: CustomerStatus;
  pipeline_stage: PipelineStage | null;
  lead_source: string | null;
  expected_monthly_cents: number | null;
  next_contact_date: string | null;
  lost_reason: string | null;
  converted_at: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  notes: string | null;
  approval_reminder_days: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  contacts: Contact[];
  social_channels: SocialChannel[];
  package_items: PackageItem[];
  package_usage: { month: string; items: PackageUsage[] };
}

// ---------------------------------------------------------------------
// Stammdaten: Leistungsarten, Team
// ---------------------------------------------------------------------

export const deliverableTypeInput = z.object({
  name: z.string().trim().min(1, 'Bezeichnung fehlt').max(100),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
});
export interface DeliverableType {
  id: number;
  name: string;
  sort_order: number;
  active: number;
}

export const teamMemberInput = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(200),
  email: optEmail,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Farbe im Format #RRGGBB')
    .optional(),
  weekly_capacity_h: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
  active: z.boolean().optional(),
});
export interface TeamMember {
  id: number;
  name: string;
  email: string | null;
  color: string;
  weekly_capacity_h: number | null;
  active: number;
}

// ---------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------

export const settingsSchema = z.object({
  agency_name: z.string().trim().min(1, 'Name der Agentur fehlt').max(100),
  approval_reminder_days: z.number().int().min(1).max(60),
  drive_root_folder: z.string().trim().min(1).max(200),
  drive_subfolders: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  briefing_email_enabled: z.boolean(),
  briefing_email_to: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Ungültige E-Mail-Adresse'),
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsUpdate = settingsSchema.partial();

export const DEFAULT_SETTINGS: Settings = {
  agency_name: 'Agentur',
  approval_reminder_days: 3,
  drive_root_folder: 'Kunden',
  drive_subfolders: ['01 Rohmaterial', '02 Entwürfe', '03 Fertige Videos', '04 Freigabe'],
  briefing_email_enabled: false,
  briefing_email_to: '',
};

// ---------------------------------------------------------------------
// Datensicherung
// ---------------------------------------------------------------------

export interface BackupInfo {
  file: string;
  size: number;
  created_at: string;
}

export interface BackupOverview {
  directory: string;
  extra_directory: string | null;
  last_backup_at: string | null;
  last_error: string | null;
  keep_days: number;
  backups: BackupInfo[];
}

// ---------------------------------------------------------------------
// Live-Ereignisse
// ---------------------------------------------------------------------

export type ChangeEntity = 'customers' | 'settings' | 'team' | 'deliverable-types' | 'backups';
export interface ChangeEvent {
  type: 'changed';
  entity: ChangeEntity;
  id?: number;
}
