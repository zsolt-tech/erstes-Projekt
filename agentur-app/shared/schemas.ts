// Gemeinsame Datentypen, Bezeichnungen und Prüfregeln für Server und Oberfläche.
import { z } from 'zod';

// Deutsche Standard-Fehlermeldungen für alle Prüfregeln ohne eigene Meldung (sonst zeigt die Oberfläche englische Texte)
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'Bitte angeben' };
      if (issue.expected === 'integer') return { message: 'Bitte eine ganze Zahl angeben' };
      if (issue.expected === 'number') return { message: 'Bitte eine Zahl angeben' };
      return { message: 'Ungültiger Wert' };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: Number(issue.minimum) <= 1 ? 'Darf nicht leer sein' : `Mindestens ${issue.minimum} Zeichen` };
      if (issue.type === 'array') return { message: `Mindestens ${issue.minimum} Einträge` };
      return { message: `Mindestens ${issue.minimum}` };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Höchstens ${issue.maximum} Zeichen` };
      if (issue.type === 'array') return { message: `Höchstens ${issue.maximum} Einträge` };
      return { message: `Höchstens ${issue.maximum}` };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Ungültige E-Mail-Adresse' };
      if (issue.validation === 'url') return { message: 'Ungültige Adresse' };
      return { message: 'Ungültiges Format' };
    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_literal:
      return { message: 'Ungültige Auswahl' };
    case z.ZodIssueCode.invalid_union:
      return { message: 'Ungültige Eingabe' };
    case z.ZodIssueCode.not_multiple_of:
      return { message: 'Bitte eine ganze Zahl angeben' };
    default:
      return { message: ctx.defaultError };
  }
});

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

/** Echtes Kalenderdatum (kein 30. Februar) */
export function isValidIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const isoDate = z.string().refine(isValidIsoDate, 'Datum im Format JJJJ-MM-TT erwartet (gültiges Datum)');

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
  // Die API liefert 0/1; beim Zurückschicken unverändert akzeptieren
  is_primary: z
    .union([z.boolean(), z.number().int().min(0).max(1)])
    .default(false)
    .transform((v) => !!v),
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
  qa_profile: z
    .enum(['standard', 'fahrschule', 'zahnarzt', 'restaurant', 'handwerk'])
    .nullish()
    .transform((v) => v ?? null),
  qa_motion_required: z.boolean().default(false),
  qa_notes: optText(5000),
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
  qa_profile: QaProfile | null;
  qa_motion_required: number;
  qa_notes: string | null;
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
  // Leer = direkt in „Meine Ablage“
  drive_root_folder: z.string().trim().max(200),
  // Reihenfolge: Rohmaterial, Schnitt, Final, Freigabe
  drive_subfolders: z.array(z.string().trim().min(1, 'Ordnername fehlt').max(100)).length(4),
  drive_customer_subfolders: z.array(z.string().trim().min(1).max(100)).max(10),
  briefing_email_enabled: z.boolean(),
  briefing_email_to: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Ungültige E-Mail-Adresse'),
  briefing_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM'),
  briefing_desktop: z.boolean(),
  reminder_enabled: z.boolean(),
  reminder_email: z.boolean(),
  // Schwellen der Engpass-Erkennung
  bottleneck_limits: z.object({
    editing_days: z.number().int().min(1).max(60),
    upload_days: z.number().int().min(1).max(60),
    approval_days: z.number().int().min(1).max(60),
    shoots_per_week: z.number().int().min(1).max(50),
    editing_parallel: z.number().int().min(1).max(100),
    deadlines_per_day: z.number().int().min(2).max(50),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsUpdate = settingsSchema.partial();

export const DEFAULT_SETTINGS: Settings = {
  agency_name: 'Agentur',
  approval_reminder_days: 3,
  drive_root_folder: 'Kunden',
  drive_subfolders: ['01 Rohmaterial', '02 Entwürfe', '03 Fertige Videos', '04 Freigabe'],
  drive_customer_subfolders: ['Scripts', 'Sonstiges'],
  briefing_time: '09:00',
  briefing_desktop: true,
  reminder_enabled: true,
  reminder_email: false,
  bottleneck_limits: {
    editing_days: 5,
    upload_days: 2,
    approval_days: 5,
    shoots_per_week: 3,
    editing_parallel: 5,
    deadlines_per_day: 4,
  },
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

export type ChangeEntity =
  | 'briefing'
  | 'notifications'
  | 'calendar'
  | 'google'
  | 'sync'
  | 'customers'
  | 'projects'
  | 'tasks'
  | 'settings'
  | 'team'
  | 'deliverable-types'
  | 'templates'
  | 'backups';
export interface ChangeEvent {
  type: 'changed';
  entity: ChangeEntity;
  id?: number;
}

/** Hinweis an offene Browserfenster (Browser-Benachrichtigung) */
export interface NotifyEvent {
  type: 'notify';
  title: string;
  body: string;
  link: string | null;
}

export type LiveEvent = ChangeEvent | NotifyEvent;

// ---------------------------------------------------------------------
// Projekte und Workflow (Etappe 2)
// ---------------------------------------------------------------------

export const PHASES = [1, 2, 3, 4, 5] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABELS: Record<Phase, string> = {
  1: 'Drehtag',
  2: 'Bearbeitung',
  3: 'Upload',
  4: 'Freigabe',
  5: 'Veröffentlichung',
};

export const PROJECT_STATUSES = ['aktiv', 'pausiert', 'abgeschlossen', 'abgebrochen'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  aktiv: 'Aktiv',
  pausiert: 'Pausiert',
  abgeschlossen: 'Abgeschlossen',
  abgebrochen: 'Abgebrochen',
};

export const PRIORITIES = ['niedrig', 'normal', 'hoch'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { niedrig: 'Niedrig', normal: 'Normal', hoch: 'Hoch' };

export const INVOICE_STATUSES = ['offen', 'gestellt', 'bezahlt'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  offen: 'Offen',
  gestellt: 'Gestellt',
  bezahlt: 'Bezahlt',
};

export const CHECKLIST_KINDS = ['standard', 'equipment', 'shot'] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];
export const CHECKLIST_KIND_LABELS: Record<ChecklistKind, string> = {
  standard: 'Checkliste',
  equipment: 'Equipment',
  shot: 'Shotlist',
};

export const TASK_STATUSES = ['offen', 'in_arbeit', 'erledigt'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  erledigt: 'Erledigt',
};

const optTime = z
  .union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM'), z.literal('')])
  .nullish()
  .transform((v) => (v ? v : null));
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Monat im Format JJJJ-MM');
const optId = id.nullish().transform((v) => v ?? null);
const optCents = z.number().int().min(0).nullish().transform((v) => v ?? null);

export const projectCreateInput = z.object({
  customer_id: z.number({ invalid_type_error: 'Kunde auswählen' }).int().positive('Kunde auswählen'),
  title: z.string().trim().min(1, 'Titel fehlt').max(200),
  description: optText(5000),
  template_id: optId,
  deliverable_type_id: optId,
  deliverable_count: z.number().int().min(1, 'Mindestens 1').max(999).nullish(),
  service_month: month.nullish(),
  priority: z.enum(PRIORITIES).default('normal'),
  shoot_date: optDate,
  start_time: optTime,
  end_time: optTime,
  location: optText(300),
  notes: optText(20000),
});
export type ProjectCreateInput = z.input<typeof projectCreateInput>;

export const projectUpdateInput = z.object({
  title: z.string().trim().min(1, 'Titel fehlt').max(200),
  description: optText(5000),
  deliverable_type_id: optId,
  deliverable_count: z.number({ invalid_type_error: 'Anzahl angeben' }).int().min(1, 'Mindestens 1').max(999),
  service_month: month,
  priority: z.enum(PRIORITIES),
  status: z.enum(['aktiv', 'pausiert', 'abgebrochen']).optional(),
  approval_reminder_days: z.number().int().min(1, 'Mindestens 1 Tag').max(60, 'Höchstens 60 Tage').nullish().transform((v) => v ?? null),
  notes: optText(20000),
});
export type ProjectUpdateInput = z.input<typeof projectUpdateInput>;

export const invoiceInput = z.object({
  invoice_status: z.enum(INVOICE_STATUSES),
  invoice_number: optText(100),
  invoice_amount_cents: optCents,
  invoice_date: optDate,
  paid_date: optDate,
});
export type InvoiceInput = z.input<typeof invoiceInput>;

export const phaseUpdateInput = z.object({
  due_date: optDate,
  assignee_id: optId,
  notes: optText(20000),
});

export const shootInput = z
  .object({
    shoot_date: optDate,
    start_time: optTime,
    end_time: optTime,
    location: optText(300),
    location_notes: optText(2000),
    shotlist_notes: optText(20000),
  })
  .refine((s) => !s.start_time || !s.end_time || s.end_time > s.start_time, {
    message: 'Ende liegt vor dem Beginn',
    path: ['end_time'],
  });
export type ShootInput = z.input<typeof shootInput>;

export const checklistCreateInput = z.object({
  phase: z.number().int().min(1).max(5),
  kind: z.enum(CHECKLIST_KINDS).default('standard'),
  label: z.string().trim().min(1, 'Bezeichnung fehlt').max(300),
});

export const checklistUpdateInput = z.object({
  label: z.string().trim().min(1, 'Bezeichnung fehlt').max(300).optional(),
  is_done: z.boolean().optional(),
});

export const moveInput = z.object({
  to_phase: z.number().int().min(1).max(5),
  reason: optText(500),
});

export const approvalDecisionInput = z.object({
  result: z.enum(['freigegeben', 'korrektur']),
  feedback: optText(5000),
  back_to_editing: z.boolean().default(true),
});

export const approvalRequestInput = z.object({ requested_date: isoDate });

export const publicationInput = z.object({
  platform: z.enum(PLATFORMS),
  planned_date: optDate,
  planned_time: optTime,
  caption: optText(5000),
  post_url: optUrl,
});
export type PublicationInput = z.input<typeof publicationInput>;

export const taskInput = z.object({
  title: z.string().trim().min(1, 'Titel fehlt').max(300),
  description: optText(10000),
  customer_id: optId,
  project_id: optId,
  phase: z.number().int().min(1).max(5).nullish().transform((v) => v ?? null),
  due_date: optDate,
  due_time: optTime,
  assignee_id: optId,
  priority: z.enum(PRIORITIES).default('normal'),
  status: z.enum(TASK_STATUSES).default('offen'),
});
export type TaskInput = z.input<typeof taskInput>;

// Antworttypen

export interface ProjectListItem {
  id: number;
  title: string;
  customer_id: number;
  customer_name: string;
  current_phase: Phase;
  status: ProjectStatus;
  priority: Priority;
  service_month: string;
  deliverable_count: number;
  deliverable_type_name: string | null;
  invoice_status: InvoiceStatus;
  phase_due_date: string | null;
  phase_entered_at: string | null;
  assignee_name: string | null;
  assignee_color: string | null;
  shoot_date: string | null;
  start_time: string | null;
  items_total: number;
  items_done: number;
  open_gates: number;
  approval_requested_at: string | null;
  correction_count: number;
  next_publication_date: string | null;
  completed_at: string | null;
  updated_at: string;
  progress: number;
  overdue: boolean;
  days_in_phase: number | null;
  approval_waiting_days: number | null;
}

export interface ProjectPhase {
  id: number;
  phase: Phase;
  due_date: string | null;
  assignee_id: number | null;
  notes: string | null;
  entered_at: string | null;
  completed_at: string | null;
}

export interface ChecklistItem {
  id: number;
  project_id: number;
  phase: Phase;
  kind: ChecklistKind;
  label: string;
  is_done: number;
  done_at: string | null;
  is_gate: number;
  is_system: number;
  auto_key: string | null;
  sort_order: number;
}

export interface Shoot {
  shoot_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  location_notes: string | null;
  shotlist_notes: string | null;
}

export interface ApprovalRound {
  id: number;
  round_no: number;
  requested_at: string;
  responded_at: string | null;
  result: 'freigegeben' | 'korrektur' | null;
  feedback: string | null;
  last_reminder_at: string | null;
  reminder_count: number;
}

export interface Publication {
  id: number;
  project_id: number;
  platform: Platform;
  planned_date: string | null;
  planned_time: string | null;
  published_at: string | null;
  post_url: string | null;
  caption: string | null;
  status: 'geplant' | 'veroeffentlicht';
}

export interface PhaseTransition {
  id: number;
  from_phase: Phase | null;
  to_phase: Phase;
  moved_at: string;
  reason: string | null;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  customer_id: number | null;
  customer_name: string | null;
  project_id: number | null;
  project_title: string | null;
  phase: Phase | null;
  due_date: string | null;
  due_time: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  priority: Priority;
  status: TaskStatus;
  completed_at: string | null;
  created_at: string;
}

export interface ProjectDetail extends ProjectListItem {
  description: string | null;
  template_id: number | null;
  template_name: string | null;
  deliverable_type_id: number | null;
  invoice_number: string | null;
  invoice_amount_cents: number | null;
  invoice_date: string | null;
  paid_date: string | null;
  approval_reminder_days: number | null;
  effective_reminder_days: number;
  notes: string | null;
  created_at: string;
  phases: ProjectPhase[];
  checklist: ChecklistItem[];
  shoot: Shoot;
  approval_rounds: ApprovalRound[];
  publications: Publication[];
  transitions: PhaseTransition[];
}

export interface ProjectTemplate {
  id: number;
  name: string;
  customer_type: CustomerType | null;
  deliverable_type_id: number | null;
  default_deliverable_count: number;
  phase_offsets: Partial<Record<Phase, number>>;
  description: string | null;
  items: { phase: Phase; kind: ChecklistKind; label: string; is_gate: number }[];
}

// ---------------------------------------------------------------------
// Google und Drive (Etappe 3)
// ---------------------------------------------------------------------

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  connected_at: string | null;
  redirect_uri: string;
  missing_scopes: string[];
}

export const DRIVE_ROLES = ['kunde', 'jahr', 'projekt', 'rohmaterial', 'schnitt', 'final', 'freigabe'] as const;
export type DriveRole = (typeof DRIVE_ROLES)[number];
export const DRIVE_ROLE_LABELS: Record<DriveRole, string> = {
  kunde: 'Kundenordner',
  jahr: 'Jahresordner',
  projekt: 'Projektordner',
  rohmaterial: 'Rohmaterial',
  schnitt: 'Schnitt / Entwürfe',
  final: 'Fertige Videos',
  freigabe: 'Freigabe',
};

export interface DriveFolder {
  id: number;
  role: DriveRole;
  year: number | null;
  name: string | null;
  google_folder_id: string;
  web_url: string;
  origin: 'angelegt' | 'verknuepft';
}

export interface DriveFile {
  name: string;
  url: string;
  modified_at: string | null;
}

export type DriveState = 'nicht_verbunden' | 'fehlt' | 'wartet' | 'fehler' | 'bereit';

export interface CustomerDrive {
  state: DriveState;
  folder: DriveFolder | null;
  error: string | null;
}

export interface ProjectDrive {
  state: DriveState;
  customer_folder: DriveFolder | null;
  folders: DriveFolder[];
  error: string | null;
  final_file_count: number | null;
  final_checked_at: string | null;
  final_files: DriveFile[];
}

export const driveLinkInput = z.object({
  url: z.string().trim().min(1, 'Link zum Ordner einfügen'),
});

export interface SyncJob {
  id: number;
  job_type: string;
  label: string;
  status: 'wartend' | 'laeuft' | 'fertig' | 'fehler';
  attempts: number;
  last_error: string | null;
  run_after: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------
// Kalender (Etappe 4)
// ---------------------------------------------------------------------

export const CALENDAR_KINDS = ['drehtag', 'deadline', 'freigabe', 'veroeffentlichung', 'termin'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];
export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  drehtag: 'Drehtage',
  deadline: 'Deadlines',
  freigabe: 'Freigabe-Fristen',
  veroeffentlichung: 'Veröffentlichungen',
  termin: 'Google-Termine',
};

/** Ein Eintrag in der Kalenderansicht der App */
export interface CalendarItem {
  id: string; // z. B. shoot:12, phase:12:3, task:5, approval:12, pub:7, google:44
  kind: CalendarKind;
  title: string;
  start: string; // YYYY-MM-DD (ganztägig) oder YYYY-MM-DDTHH:MM (Ortszeit) bzw. ISO bei Google-Terminen
  end: string | null;
  all_day: boolean;
  url: string | null; // Ziel in der App
  external_url: string | null; // Link zu Google
  customer_id: number | null;
  customer_name: string | null;
  location: string | null;
  editable: boolean;
}

export const calendarMoveInput = z.object({
  id: z.string().min(3),
  start: z.string().min(10),
  end: z.string().nullish(),
  all_day: z.boolean(),
});

export interface CalendarInfo {
  id: string;
  name: string;
  color: string | null;
  primary: boolean;
  access_role: string | null;
  read_enabled: boolean;
}

export interface CalendarSettings {
  connected: boolean;
  calendars: CalendarInfo[];
  write_id: string;
  push_approvals: boolean;
  push_publications: boolean;
  last_sync_at: string | null;
  last_error: string | null;
}

export const calendarSettingsInput = z.object({
  write_id: z.string().min(1),
  read_ids: z.array(z.string()).max(50),
  push_approvals: z.boolean(),
  push_publications: z.boolean(),
});

export type ShootCalendarState = 'nicht_verbunden' | 'kein_datum' | 'wartet' | 'eingetragen' | 'in_google_geloescht';

export interface ShootCalendar {
  state: ShootCalendarState;
  html_link: string | null;
}

// ---------------------------------------------------------------------
// Briefing, Engpässe, Benachrichtigungen (Etappe 5)
// ---------------------------------------------------------------------

export interface Bottleneck {
  key: string; // stabil, für Benachrichtigungen ohne Doppelung
  level: 'hoch' | 'mittel';
  kind: 'phase' | 'drehtag' | 'veroeffentlichung' | 'auslastung' | 'deadlines' | 'paket';
  text: string;
  url: string | null;
}

export interface BriefingData {
  date: string;
  generated_at: string;
  agency_name: string;
  summary: string;
  appointments: { time: string | null; title: string; kind: CalendarKind; location: string | null; url: string | null }[];
  due_today: { title: string; customer: string | null; url: string | null }[];
  overdue: { title: string; customer: string | null; due_date: string; days: number; url: string | null }[];
  approvals: { title: string; customer: string; requested_at: string; waiting_days: number; follow_up: boolean; url: string }[];
  shoots: { date: string; time: string | null; title: string; customer: string; location: string | null; url: string }[];
  packages: {
    customer_id: number;
    customer: string;
    month: string;
    items: { type: string; used: number; quantity: number }[];
    status: 'ok' | 'rueckstand' | 'ueber';
  }[];
  warnings: Bottleneck[];
}

export interface Briefing {
  id: number;
  briefing_date: string;
  generated_at: string;
  data: BriefingData;
  text: string;
  notified_at: string | null;
  emailed_at: string | null;
}

export type NotificationType = 'briefing' | 'freigabe_erinnerung' | 'engpass' | 'sync_fehler' | 'backup' | 'system';

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

// ---------------------------------------------------------------------
// Videoschnitt-Agenten und Qualitätsprüfung
// ---------------------------------------------------------------------

export const QA_PROFILES = ['standard', 'fahrschule', 'zahnarzt', 'restaurant', 'handwerk'] as const;
export type QaProfile = (typeof QA_PROFILES)[number];
export const QA_PROFILE_LABELS: Record<QaProfile, string> = {
  standard: 'Standard',
  fahrschule: 'Fahrschule',
  zahnarzt: 'Arzt- und Zahnarztpraxis (streng)',
  restaurant: 'Restaurant (Schärfe streng)',
  handwerk: 'Handwerk',
};
/** Prüfprofil, wenn beim Kunden keins gewählt ist */
export const QA_PROFILE_BY_TYPE: Record<CustomerType, QaProfile> = {
  restaurant: 'restaurant',
  handwerk: 'handwerk',
  arztpraxis: 'zahnarzt',
  fahrschule: 'fahrschule',
  sonstige: 'standard',
};

export const qualityCheckInput = z.object({
  video_name: z.string().trim().min(1, 'Name des Videos fehlt').max(300),
  stage: z.enum(['vorpruefung', 'endkontrolle']),
  verdict: z.enum(['freigegeben', 'zurueck', 'offen']),
  run_no: z.number().int().min(1).max(20).default(1),
  profile: z.enum(QA_PROFILES).nullish().transform((v) => v ?? null),
  shots: z.number().int().min(0).max(10000).nullish().transform((v) => v ?? null),
  drone_perspectives: z.number().int().min(0).max(100).nullish().transform((v) => v ?? null),
  summary: optText(2000),
  issues: z
    .array(z.object({ t: z.string().trim().max(20).nullish().transform((v) => v ?? null), text: z.string().trim().min(1).max(500) }))
    .max(200)
    .default([]),
  clip_list: optText(50000),
  source: z.enum(['agent', 'manuell']).default('agent'),
});
export type QualityCheckInput = z.input<typeof qualityCheckInput>;

export interface QualityCheck {
  id: number;
  project_id: number;
  video_name: string;
  stage: 'vorpruefung' | 'endkontrolle';
  verdict: 'freigegeben' | 'zurueck' | 'offen';
  run_no: number;
  profile: QaProfile | null;
  shots: number | null;
  drone_perspectives: number | null;
  summary: string | null;
  issues: { t: string | null; text: string }[];
  clip_list: string | null;
  source: 'agent' | 'manuell';
  created_at: string;
}

export type AgentKind = 'videoschnitt' | 'endkontrolle' | 'highlight' | 'pdf';
