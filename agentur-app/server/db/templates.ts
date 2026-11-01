// Mitgelieferte Projektvorlagen je Kundentyp mit vorausgefüllten Checklisten.
// Werden beim ersten Start angelegt und lassen sich später in der App anpassen.
import type { Database } from './database.ts';
import type { ChecklistKind, CustomerType, Phase } from '../../shared/schemas.ts';

type Item = [Phase, ChecklistKind, string];

interface TemplateDef {
  name: string;
  customer_type: CustomerType | null;
  deliverable: string;
  count: number;
  offsets: Partial<Record<Phase, number>>;
  description: string;
  items: Item[];
}

// Grundausstattung, die jede Vorlage enthält
const BASE: Item[] = [
  [1, 'standard', 'Drehtermin mit Kunde bestätigt'],
  [1, 'standard', 'Shotlist mit Kunde abgestimmt'],
  [1, 'standard', 'Einverständnis gefilmter Personen geklärt'],
  [1, 'equipment', 'Kamera und Objektive'],
  [1, 'equipment', 'Akkus geladen'],
  [1, 'equipment', 'Speicherkarten leer und formatiert'],
  [1, 'equipment', 'Mikrofone'],
  [1, 'equipment', 'Licht'],
  [1, 'equipment', 'Gimbal und Stativ'],
  [2, 'standard', 'Material gesichert (Rohmaterial in Drive)'],
  [2, 'standard', 'Material gesichtet und ausgewählt'],
  [2, 'standard', 'Schnitt'],
  [2, 'standard', 'Farbkorrektur'],
  [2, 'standard', 'Ton und lizenzfreie Musik'],
  [2, 'standard', 'Untertitel'],
  [3, 'standard', 'Export in allen benötigten Formaten (9:16, 1:1, 16:9)'],
  [4, 'standard', 'Freigabelink an Kunden gesendet'],
  [5, 'standard', 'Caption und Hashtags'],
  [5, 'standard', 'Titelbild ausgewählt'],
  [5, 'standard', 'Beitrag geplant oder veröffentlicht'],
];

const OFFSETS = { 2: 3, 3: 5, 4: 6, 5: 12 };

const TEMPLATES: TemplateDef[] = [
  {
    name: 'Standard',
    customer_type: null,
    deliverable: 'Reel',
    count: 1,
    offsets: OFFSETS,
    description: 'Allgemeine Vorlage für Social-Media-Videos',
    items: BASE,
  },
  {
    name: 'Restaurant / Gastronomie',
    customer_type: 'restaurant',
    deliverable: 'Reel',
    count: 4,
    offsets: OFFSETS,
    description: 'Food-Content, Atmosphäre und Team',
    items: [
      ...BASE,
      [1, 'standard', 'Dreh außerhalb der Stoßzeiten geplant'],
      [1, 'standard', 'Gerichte für den Dreh mit der Küche abgestimmt'],
      [1, 'equipment', 'Makro-Objektiv für Food-Aufnahmen'],
      [1, 'shot', 'Außenansicht und Eingang'],
      [1, 'shot', 'Küche in Aktion'],
      [1, 'shot', 'Signature-Gericht beim Anrichten'],
      [1, 'shot', 'Atmosphäre im Gastraum'],
      [1, 'shot', 'Inhaber oder Küchenchef im Statement'],
    ],
  },
  {
    name: 'Handwerk',
    customer_type: 'handwerk',
    deliverable: 'Reel',
    count: 2,
    offsets: OFFSETS,
    description: 'Arbeitsprozesse, Vorher-Nachher und Team',
    items: [
      ...BASE,
      [1, 'standard', 'Sicherheitsunterweisung vor Ort, Schutzausrüstung'],
      [1, 'standard', 'Zugang zur Baustelle mit Bauherr geklärt'],
      [1, 'shot', 'Baustelle oder Werkstatt in der Totalen'],
      [1, 'shot', 'Arbeitsschritte in Nahaufnahme'],
      [1, 'shot', 'Vorher-Nachher'],
      [1, 'shot', 'Team bei der Arbeit'],
      [1, 'shot', 'Fahrzeuge mit Logo'],
      [4, 'standard', 'Keine Kundendaten von Bauherren sichtbar'],
    ],
  },
  {
    name: 'Arztpraxis',
    customer_type: 'arztpraxis',
    deliverable: 'Reel',
    count: 2,
    offsets: { 2: 3, 3: 5, 4: 6, 5: 14 },
    description: 'Praxisvorstellung mit Datenschutz und Heilmittelwerbegesetz',
    items: [
      ...BASE,
      [1, 'standard', 'Dreh außerhalb der Sprechzeiten'],
      [1, 'standard', 'Schriftliche Einwilligung aller gefilmten Personen'],
      [1, 'standard', 'Keine Patientendaten im Bild (Bildschirme, Akten)'],
      [1, 'shot', 'Empfang und Wartebereich'],
      [1, 'shot', 'Behandlungsraum ohne Patienten'],
      [1, 'shot', 'Teamvorstellung'],
      [1, 'shot', 'Statement Ärztin oder Arzt'],
      [4, 'standard', 'Aussagen auf Heilmittelwerbegesetz (HWG) geprüft'],
    ],
  },
  {
    name: 'Fahrschule',
    customer_type: 'fahrschule',
    deliverable: 'Reel',
    count: 4,
    offsets: OFFSETS,
    description: 'Fahrzeuge, Fahrlehrer und Erfolgsmomente',
    items: [
      ...BASE,
      [1, 'standard', 'Einverständnis der Fahrschüler eingeholt'],
      [1, 'equipment', 'Saugnapfhalterung für Innenaufnahmen'],
      [1, 'shot', 'Fahrzeugflotte'],
      [1, 'shot', 'Fahrstunde aus der Innenperspektive'],
      [1, 'shot', 'Theorieraum'],
      [1, 'shot', 'Vorstellung der Fahrlehrer'],
      [1, 'shot', 'Bestanden-Moment'],
    ],
  },
];

export function seedTemplates(db: Database): void {
  const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM project_templates')!.n;
  if (count > 0) return;
  for (const t of TEMPLATES) {
    const dt = db.get<{ id: number }>('SELECT id FROM deliverable_types WHERE name = ?', [t.deliverable]);
    const r = db.run(
      `INSERT INTO project_templates (name, customer_type, deliverable_type_id, default_deliverable_count, phase_offsets_json, description)
       VALUES (:name, :type, :dt, :count, :offsets, :description)`,
      {
        name: t.name,
        type: t.customer_type,
        dt: dt?.id ?? null,
        count: t.count,
        offsets: JSON.stringify(t.offsets),
        description: t.description,
      },
    );
    // Reihenfolge: zuerst Checkliste, dann Equipment, dann Shotlist
    const order: Record<ChecklistKind, number> = { standard: 0, equipment: 1000, shot: 2000 };
    t.items.forEach(([phase, kind, label], i) => {
      db.run(
        `INSERT INTO template_checklist_items (template_id, phase, kind, label, sort_order)
         VALUES (:tid, :phase, :kind, :label, :sort)`,
        { tid: r.lastInsertRowid, phase, kind, label, sort: order[kind] + i },
      );
    });
  }
}
