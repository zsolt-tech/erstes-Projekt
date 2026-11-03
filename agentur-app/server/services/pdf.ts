// PDF-Erzeugung: Monatsbericht für Kunden, Drehplan, Freigabe-Protokoll, Briefing.
// Schlichtes, sachliches Layout im A4-Format mit Kopf, Abschnitten, Tabellen und Seitenzahlen.
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { Database } from '../db/database.ts';
import { HttpError } from '../lib/http.ts';
import { addDays, berlinDateOf, berlinParts, monthRange, todayBerlin } from '../lib/time.ts';
import { getCustomer } from './customers.ts';
import { getProject } from './projects.ts';
import { getSettings } from './settings.ts';
import { listQualityChecks, effectiveProfile } from './agents.ts';
import {
  PHASE_LABELS,
  PLATFORM_LABELS,
  PROJECT_STATUS_LABELS,
  QA_PROFILE_LABELS,
  type BriefingData,
  type Phase,
  type Platform,
  type ProjectStatus,
} from '../../shared/schemas.ts';

const COLOR = {
  text: '#1a1f29',
  muted: '#5b6474',
  subtle: '#8a92a1',
  line: '#d9dde4',
  soft: '#f2f4f7',
  accent: '#2f54c9',
  success: '#237a3b',
  warning: '#9a6200',
  danger: '#c0352b',
};
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/**
 * Schrift mit vollem Unicode-Umfang (z. B. für Namen wie Yılmaz oder Łódź): Arial bzw. DejaVu des
 * Betriebssystems einbetten. Fehlen sie, bleibt es bei Helvetica (nur westeuropäische Zeichen).
 */
const FONT_CANDIDATES: [string, string][] = [
  ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'],
  ['/Library/Fonts/Arial.ttf', '/Library/Fonts/Arial Bold.ttf'],
  [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'arial.ttf'), path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'arialbd.ttf')],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'],
];
const FONT_FILES = FONT_CANDIDATES.find(([r, b]) => fs.existsSync(r) && fs.existsSync(b)) ?? null;
const FONT = FONT_FILES ? { regular: 'Text', bold: 'Text-Bold' } : { regular: 'Helvetica', bold: 'Helvetica-Bold' };

const pad = (n: number) => String(n).padStart(2, '0');
export const dateDe = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '–');
const isoDe = (iso: string | null | undefined) => {
  if (!iso) return '–';
  const p = berlinParts(new Date(iso));
  return `${pad(p.day)}.${pad(p.month)}.${p.year}`;
};
const monthDe = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const longDate = (d: string) => `${DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]}, ${Number(d.slice(8, 10))}. ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const tage = (n: number) => (n === 1 ? '1 Tag' : `${n} Tagen`);

/** Dateiname ohne Sonderzeichen, z. B. "Monatsbericht_Pizzeria-Roma_2026-11.pdf" */
export function pdfFileName(...parts: string[]): string {
  const clean = parts
    .map((p) =>
      p
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/ß/g, 'ss')
        .replace(/[^A-Za-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean);
  return `${clean.join('_')}.pdf`;
}

type Cell = string | { text: string; link?: string | null; color?: string; bold?: boolean };

class Pdf {
  readonly doc: PDFKit.PDFDocument;
  private chunks: Buffer[] = [];
  private readonly left = 56;
  private readonly width: number;

  constructor(
    private agency: string,
    title: string,
    subtitle: string,
  ) {
    this.doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 64, left: 56, right: 56 },
      bufferPages: true,
      info: { Title: `${title} – ${subtitle}`, Author: agency, Creator: 'Agentur-Verwaltung' },
    });
    this.width = this.doc.page.width - 112;
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
    if (FONT_FILES) {
      this.doc.registerFont(FONT.regular, FONT_FILES[0]);
      this.doc.registerFont(FONT.bold, FONT_FILES[1]);
    }
    this.doc.font(FONT.regular).fillColor(COLOR.text);
    this.doc.fontSize(9).fillColor(COLOR.muted).text(agency.toUpperCase(), { characterSpacing: 0.8 });
    this.doc.moveDown(0.4);
    this.doc.font(FONT.bold).fontSize(20).fillColor(COLOR.text).text(title);
    this.doc.font(FONT.regular).fontSize(12).fillColor(COLOR.muted).text(subtitle);
    this.doc.moveDown(0.6);
    this.rule();
    this.doc.moveDown(0.8);
  }

  private rule(color = COLOR.line) {
    const y = this.doc.y;
    this.doc.save().moveTo(this.left, y).lineTo(this.left + this.width, y).lineWidth(0.7).strokeColor(color).stroke().restore();
  }

  ensureSpace(h: number) {
    if (this.doc.y + h > this.doc.page.height - this.doc.page.margins.bottom) this.doc.addPage();
  }

  h2(text: string) {
    this.ensureSpace(60);
    this.doc.moveDown(0.6);
    this.doc.font(FONT.bold).fontSize(12.5).fillColor(COLOR.text).text(text, this.left);
    this.doc.moveDown(0.35);
  }

  para(text: string, opts: { color?: string; size?: number; bold?: boolean } = {}) {
    this.doc
      .font(opts.bold ? FONT.bold : FONT.regular)
      .fontSize(opts.size ?? 10.5)
      .fillColor(opts.color ?? COLOR.text)
      .text(text, this.left, undefined, { width: this.width, lineGap: 2 });
    this.doc.moveDown(0.3);
  }

  muted(text: string) {
    this.para(text, { color: COLOR.muted, size: 9.5 });
  }

  /** Beschriftete Zeilen: Bezeichnung links, Wert rechts */
  kv(rows: [string, Cell | null | undefined][]) {
    const labelW = 130;
    for (const [label, value] of rows) {
      if (value === null || value === undefined || value === '') continue;
      const v = typeof value === 'string' ? { text: value } : value;
      this.doc.font(FONT.regular).fontSize(10.5);
      const h = Math.max(this.doc.heightOfString(v.text, { width: this.width - labelW }), 14);
      this.ensureSpace(h + 4);
      const y = this.doc.y;
      this.doc.fillColor(COLOR.muted).text(label, this.left, y, { width: labelW - 10 });
      this.doc
        .font(v.bold ? FONT.bold : FONT.regular)
        .fillColor(v.link ? COLOR.accent : (v.color ?? COLOR.text))
        .text(v.text, this.left + labelW, y, { width: this.width - labelW, link: v.link ?? undefined, underline: !!v.link, lineGap: 1.5 });
      this.doc.y = Math.max(this.doc.y, y + h) + 4;
    }
    this.doc.x = this.left;
  }

  /** Kennzahlen als Kacheln in einer Reihe */
  kpis(items: { label: string; value: string }[]) {
    const gap = 10;
    const w = (this.width - gap * (items.length - 1)) / items.length;
    this.ensureSpace(60);
    const y = this.doc.y;
    // Beschriftungen dürfen umbrechen; die Werte stehen in allen Kacheln auf gleicher Höhe darunter
    this.doc.font(FONT.regular).fontSize(8.5);
    const labelH = Math.max(...items.map((it) => this.doc.heightOfString(it.label, { width: w - 20 })));
    const valueY = y + 9 + labelH + 4;
    const h = valueY - y + 20 + 8;
    this.ensureSpace(h + 10);
    items.forEach((it, i) => {
      const x = this.left + i * (w + gap);
      this.doc.save().roundedRect(x, y, w, h, 4).fillColor(COLOR.soft).fill().restore();
      this.doc.font(FONT.regular).fontSize(8.5).fillColor(COLOR.muted).text(it.label, x + 10, y + 9, { width: w - 20 });
      this.doc.font(FONT.bold).fontSize(16).fillColor(COLOR.text).text(it.value, x + 10, valueY, { width: w - 20 });
    });
    this.doc.x = this.left;
    this.doc.y = y + h + 10;
  }

  /** Tabelle mit Kopfzeile, Umbruch innerhalb der Zellen und Seitenwechsel */
  table(columns: { label: string; width: number; align?: 'left' | 'right' }[], rows: Cell[][], empty = 'Keine Einträge.') {
    if (!rows.length) {
      this.muted(empty);
      return;
    }
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const pad = 4;
    const header = () => {
      this.ensureSpace(40);
      const y = this.doc.y;
      let x = this.left;
      let bottom = y + 14;
      this.doc.font(FONT.bold).fillColor(COLOR.muted);
      columns.forEach((c, i) => {
        const label = c.label.toUpperCase();
        const w = widths[i] - pad * 2;
        // Überschrift nicht mitten im Wort umbrechen: notfalls etwas kleiner setzen
        let size = 8.5;
        while (size > 6.5 && this.doc.fontSize(size).widthOfString(label, { characterSpacing: 0.4 }) > w && !label.includes(' ')) size -= 0.5;
        this.doc.fontSize(size).text(label, x + pad, y, { width: w, align: c.align ?? 'left', characterSpacing: 0.4 });
        bottom = Math.max(bottom, y + this.doc.heightOfString(label, { width: w, characterSpacing: 0.4 }) + 4);
        x += widths[i];
      });
      this.doc.fontSize(8.5);
      this.doc.y = bottom;
      this.rule();
      this.doc.y += 4;
    };
    header();
    for (const row of rows) {
      const cells = row.map((c) => (typeof c === 'string' ? { text: c } : c));
      this.doc.fontSize(9.5);
      const h = Math.max(
        ...cells.map((c, i) => {
          this.doc.font(c.bold ? FONT.bold : FONT.regular);
          return this.doc.heightOfString(c.text || '–', { width: widths[i] - pad * 2, lineGap: 1 });
        }),
      );
      if (this.doc.y + h + 8 > this.doc.page.height - this.doc.page.margins.bottom) {
        this.doc.addPage();
        header();
      }
      const y = this.doc.y;
      let x = this.left;
      cells.forEach((c, i) => {
        this.doc
          .font(c.bold ? FONT.bold : FONT.regular)
          .fontSize(9.5)
          .fillColor(c.link ? COLOR.accent : (c.color ?? COLOR.text))
          .text(c.text || '–', x + pad, y, {
            width: widths[i] - pad * 2,
            align: columns[i].align ?? 'left',
            link: c.link ?? undefined,
            underline: !!c.link,
            lineGap: 1,
          });
        x += widths[i];
      });
      this.doc.y = y + h + 4;
      this.rule('#eceef2');
      this.doc.y += 4;
    }
    this.doc.x = this.left;
    this.doc.moveDown(0.2);
  }

  /** Abhakliste mit Kästchen */
  checklist(items: { label: string; done?: boolean }[], empty = 'Keine Punkte.') {
    if (!items.length) {
      this.muted(empty);
      return;
    }
    for (const it of items) {
      this.doc.font(FONT.regular).fontSize(10.5);
      const h = Math.max(this.doc.heightOfString(it.label, { width: this.width - 22 }), 13);
      this.ensureSpace(h + 6);
      const y = this.doc.y;
      this.doc.save().rect(this.left, y + 1.5, 9, 9).lineWidth(0.8).strokeColor(COLOR.muted).stroke();
      if (it.done) {
        this.doc
          .moveTo(this.left + 1.8, y + 6)
          .lineTo(this.left + 3.8, y + 8.5)
          .lineTo(this.left + 7.5, y + 3)
          .lineWidth(1.2)
          .strokeColor(COLOR.success)
          .stroke();
      }
      this.doc.restore();
      this.doc.fillColor(it.done ? COLOR.muted : COLOR.text).text(it.label, this.left + 18, y, { width: this.width - 22 });
      this.doc.y = Math.max(this.doc.y, y + h) + 4;
    }
    this.doc.x = this.left;
  }

  bullets(items: { text: string; meta?: string; color?: string }[], empty: string) {
    if (!items.length) {
      this.muted(empty);
      return;
    }
    for (const it of items) {
      const text = it.meta ? `${it.text}  ·  ${it.meta}` : it.text;
      this.doc.font(FONT.regular).fontSize(10.5);
      const h = this.doc.heightOfString(text, { width: this.width - 14 });
      this.ensureSpace(h + 4);
      const y = this.doc.y;
      this.doc.fillColor(it.color ?? COLOR.accent).text('•', this.left, y);
      this.doc.fillColor(COLOR.text).text(text, this.left + 12, y, { width: this.width - 14, lineGap: 1.5 });
      this.doc.y = Math.max(this.doc.y, y + h) + 3;
    }
    this.doc.x = this.left;
  }

  /** Fußzeilen setzen und fertiges PDF liefern */
  finish(): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    const stamp = `Erstellt am ${dateDe(todayBerlin())}`;
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const bottom = this.doc.page.margins.bottom;
      this.doc.page.margins.bottom = 0;
      const y = this.doc.page.height - 40;
      this.doc.font(FONT.regular).fontSize(8).fillColor(COLOR.subtle);
      this.doc.text(`${this.agency} · ${stamp}`, this.left, y, { width: this.width / 2, lineBreak: false });
      this.doc.text(`Seite ${i - range.start + 1} von ${range.count}`, this.left + this.width / 2, y, {
        width: this.width / 2,
        align: 'right',
        lineBreak: false,
      });
      this.doc.page.margins.bottom = bottom;
    }
    return new Promise((resolve) => {
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.end();
    });
  }
}

const agencyName = (db: Database) => getSettings(db).agency_name;

// ---------------------------------------------------------------------
// Monatsbericht für einen Kunden (zum Weitergeben, ohne interne Angaben)
// ---------------------------------------------------------------------

/** Datum einer Veröffentlichung in Berliner Zeit: geplantes Datum, sonst Zeitpunkt der Veröffentlichung */
function pubDate(pu: { planned_date: string | null; published_at: string | null }): string | null {
  if (pu.planned_date) return pu.planned_date;
  if (!pu.published_at) return null;
  return pu.published_at.length > 10 ? berlinDateOf(pu.published_at) : pu.published_at;
}

export async function monthlyReport(db: Database, customerId: number, month: string): Promise<{ file: string; pdf: Buffer }> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Monat im Format JJJJ-MM erwartet');
  const c = getCustomer(db, customerId, month);
  const { start, end } = monthRange(month);
  const pubs = db.all<{ title: string; platform: Platform; planned_date: string | null; planned_time: string | null; published_at: string | null; post_url: string | null; status: string }>(
    `SELECT p.title, pu.platform, pu.planned_date, pu.planned_time, pu.published_at, pu.post_url, pu.status
     FROM publications pu JOIN projects p ON p.id = pu.project_id
     WHERE p.customer_id = :cid AND p.status <> 'abgebrochen'
       AND COALESCE(pu.planned_date, substr(pu.published_at, 1, 10)) BETWEEN :from AND :to
     ORDER BY COALESCE(pu.planned_date, pu.published_at), pu.planned_time`,
    // Zeitstempel sind UTC: einen Tag Puffer abfragen und unten nach Berliner Datum filtern
    { cid: customerId, from: addDays(start, -1), to: addDays(end, 1) },
  ).filter((pu) => {
    const d = pubDate(pu);
    return !!d && d >= start && d <= end;
  });
  const projects = db.all<{ id: number; title: string; status: ProjectStatus; current_phase: Phase; deliverable_count: number; type: string | null; completed_at: string | null; service_month: string | null; corrections: number }>(
    `SELECT p.id, p.title, p.status, p.current_phase, p.deliverable_count, dt.name AS type, p.completed_at, p.service_month,
            (SELECT COUNT(*) FROM approval_rounds ar WHERE ar.project_id = p.id AND ar.result = 'korrektur') AS corrections
     FROM projects p LEFT JOIN deliverable_types dt ON dt.id = p.deliverable_type_id
     WHERE p.customer_id = :cid AND p.status <> 'abgebrochen'
       AND (p.service_month = :month OR substr(p.completed_at, 1, 10) BETWEEN :from AND :to)
     ORDER BY p.completed_at IS NULL, p.completed_at, p.id`,
    { cid: customerId, month, from: addDays(start, -1), to: addDays(end, 1) },
  ).filter((p) => p.service_month === month || (!!p.completed_at && berlinDateOf(p.completed_at).slice(0, 7) === month));
  const nextFrom = addDays(end, 1);
  const nextTo = addDays(end, 31);
  const upcoming = db.all<{ date: string; time: string | null; text: string }>(
    `SELECT s.shoot_date AS date, s.start_time AS time, 'Drehtag: ' || p.title AS text FROM shoots s JOIN projects p ON p.id = s.project_id
     WHERE p.customer_id = :cid AND p.status IN ('aktiv','pausiert') AND s.shoot_date BETWEEN :from AND :to
     UNION ALL
     SELECT pu.planned_date, pu.planned_time, 'Veröffentlichung ' || pu.platform || ': ' || p.title FROM publications pu JOIN projects p ON p.id = pu.project_id
     WHERE p.customer_id = :cid AND p.status <> 'abgebrochen' AND pu.status = 'geplant' AND pu.planned_date BETWEEN :from AND :to
     ORDER BY 1, 2`,
    { cid: customerId, from: nextFrom, to: nextTo },
  ).map((u) => ({ ...u, text: u.text.replace(/^Veröffentlichung (\w+):/, (_m, p: Platform) => `Veröffentlichung ${PLATFORM_LABELS[p] ?? p}:`) }));

  const published = pubs.filter((p) => p.status === 'veroeffentlicht').length;
  const completed = projects.filter((p) => p.completed_at && berlinDateOf(p.completed_at).slice(0, 7) === month).length;
  const used = c.package_usage.items.reduce((s, i) => s + i.used, 0);
  const booked = c.package_usage.items.reduce((s, i) => s + i.quantity, 0);

  const pdf = new Pdf(agencyName(db), `Monatsbericht ${monthDe(month)}`, c.company_name);
  pdf.kpis([
    { label: 'Veröffentlichungen', value: String(published) },
    { label: 'Projekte abgeschlossen', value: String(completed) },
    { label: 'Projekte im Monat', value: String(projects.length) },
    { label: 'Paket umgesetzt', value: booked ? `${used} von ${booked}` : '–' },
  ]);

  pdf.h2('Gebuchtes Paket');
  pdf.table(
    [
      { label: 'Leistung', width: 2.6 },
      { label: 'Gebucht', width: 1.3, align: 'right' },
      { label: 'Umgesetzt', width: 1.4, align: 'right' },
      { label: 'Veröffentlicht', width: 1.8, align: 'right' },
    ],
    c.package_usage.items.map((i) => [
      i.deliverable_type_name,
      String(i.quantity),
      { text: String(i.used), color: i.used > i.quantity ? COLOR.warning : undefined },
      String(i.completed),
    ]),
    'Für diesen Monat ist kein Paket gebucht.',
  );

  pdf.h2('Veröffentlichungen');
  pdf.table(
    [
      { label: 'Datum', width: 1.3 },
      { label: 'Plattform', width: 1.6 },
      { label: 'Beitrag', width: 3 },
      { label: 'Link', width: 2.4 },
    ],
    pubs.map((p) => [
      `${dateDe(pubDate(p))}${p.planned_time ? `, ${p.planned_time}` : ''}`,
      PLATFORM_LABELS[p.platform],
      p.title,
      p.post_url ? { text: p.post_url.replace(/^https?:\/\//, ''), link: p.post_url } : { text: p.status === 'veroeffentlicht' ? 'veröffentlicht' : 'geplant', color: COLOR.muted },
    ]),
    'In diesem Monat gab es keine Veröffentlichungen.',
  );

  pdf.h2('Projekte');
  pdf.table(
    [
      { label: 'Projekt', width: 2.8 },
      { label: 'Leistung', width: 1.6 },
      { label: 'Stand', width: 2.2 },
      { label: 'Korrekturen', width: 1.6, align: 'right' },
    ],
    projects.map((p) => [
      p.title,
      p.type ? `${p.deliverable_count} × ${p.type}` : '–',
      p.status === 'abgeschlossen'
        ? { text: `abgeschlossen ${isoDe(p.completed_at)}`, color: COLOR.success }
        : p.status === 'aktiv'
          ? `in Arbeit: ${PHASE_LABELS[p.current_phase]}`
          : PROJECT_STATUS_LABELS[p.status],
      String(p.corrections),
    ]),
    'Keine Projekte in diesem Monat.',
  );

  pdf.h2('Ausblick');
  pdf.bullets(
    upcoming.map((u) => ({ text: u.text, meta: `${dateDe(u.date)}${u.time ? `, ${u.time} Uhr` : ''}` })),
    'Für die nächsten Wochen sind noch keine Termine geplant.',
  );
  return { file: pdfFileName('Monatsbericht', c.company_name, month), pdf: await pdf.finish() };
}

// ---------------------------------------------------------------------
// Drehplan zum Mitnehmen
// ---------------------------------------------------------------------

export async function shootPlan(db: Database, projectId: number): Promise<{ file: string; pdf: Buffer }> {
  const p = getProject(db, projectId);
  const c = getCustomer(db, p.customer_id);
  const rawFolder = db.get<{ web_url: string; name: string | null }>("SELECT web_url, name FROM drive_folders WHERE project_id = ? AND role = 'rohmaterial'", [projectId]);
  const pdf = new Pdf(agencyName(db), 'Drehplan', `${c.company_name} – ${p.title}`);
  const time = p.shoot.start_time ? `${p.shoot.start_time}${p.shoot.end_time ? ` bis ${p.shoot.end_time}` : ''} Uhr` : 'ganztägig';
  pdf.kv([
    ['Datum', p.shoot.shoot_date ? { text: longDate(p.shoot.shoot_date), bold: true } : { text: 'noch nicht festgelegt', color: COLOR.warning }],
    ['Uhrzeit', p.shoot.shoot_date ? time : null],
    ['Ort', p.shoot.location],
    ['Hinweise vor Ort', p.shoot.location_notes],
    ['Leistung', p.deliverable_type_name ? `${p.deliverable_count} × ${p.deliverable_type_name}, ${monthDe(p.service_month)}` : null],
    ['Rohmaterial', rawFolder ? { text: `Drive: ${rawFolder.name ?? 'Rohmaterial'}`, link: rawFolder.web_url } : null],
  ]);
  if (c.contacts.length) {
    pdf.h2('Ansprechpartner');
    pdf.table(
      [
        { label: 'Name', width: 2.2 },
        { label: 'Rolle', width: 1.6 },
        { label: 'Telefon', width: 1.8 },
        { label: 'E-Mail', width: 2.4 },
      ],
      c.contacts.map((x) => [{ text: x.name, bold: !!x.is_primary }, x.role ?? '', x.phone ?? '', x.email ?? '']),
    );
  }
  const items = (kind: string) => p.checklist.filter((i) => i.phase === 1 && i.kind === kind).map((i) => ({ label: i.label, done: !!i.is_done }));
  pdf.h2('Shotlist');
  pdf.checklist(items('shot'), 'Keine Einstellungen erfasst.');
  if (p.shoot.shotlist_notes) {
    pdf.doc.moveDown(0.2);
    pdf.muted(p.shoot.shotlist_notes);
  }
  pdf.h2('Equipment');
  pdf.checklist(items('equipment'), 'Keine Equipment-Liste erfasst.');
  pdf.h2('Vor dem Dreh');
  pdf.checklist(items('standard'), 'Keine Punkte erfasst.');
  const qa = effectiveProfile(c);
  pdf.h2('Für den Schnitt');
  pdf.kv([
    ['Prüfprofil', `${QA_PROFILE_LABELS[qa.profil]}${c.qa_motion_required ? ', durchgehende Kamerabewegung Pflicht' : ''}`],
    ['Hinweise', c.qa_notes],
    ['Notizen Drehtag', p.phases.find((x) => x.phase === 1)?.notes],
  ]);
  return { file: pdfFileName('Drehplan', c.company_name, p.title, p.shoot.shoot_date ?? ''), pdf: await pdf.finish() };
}

// ---------------------------------------------------------------------
// Freigabe-Protokoll als Nachweis
// ---------------------------------------------------------------------

export async function approvalProtocol(db: Database, projectId: number): Promise<{ file: string; pdf: Buffer }> {
  const p = getProject(db, projectId);
  const c = getCustomer(db, p.customer_id);
  const rounds = [...p.approval_rounds].sort((a, b) => a.round_no - b.round_no);
  const approved = [...rounds].reverse().find((r) => r.result === 'freigegeben');
  const contact = c.contacts.find((x) => x.is_primary) ?? c.contacts[0];
  const pdf = new Pdf(agencyName(db), 'Freigabe-Protokoll', `${c.company_name} – ${p.title}`);
  pdf.kv([
    ['Projekt', p.title],
    ['Kunde', c.company_name],
    ['Ansprechpartner', contact ? `${contact.name}${contact.email ? `, ${contact.email}` : ''}` : null],
    ['Leistung', p.deliverable_type_name ? `${p.deliverable_count} × ${p.deliverable_type_name}` : null],
    ['Korrekturschleifen', String(p.correction_count)],
    ['Freigabe', approved ? { text: `erteilt am ${isoDe(approved.responded_at)}`, color: COLOR.success, bold: true } : { text: rounds.length ? 'noch offen' : 'noch nicht angefragt', color: COLOR.warning }],
  ]);
  pdf.h2('Freigaberunden');
  pdf.table(
    [
      { label: 'Runde', width: 0.8 },
      { label: 'Angefragt', width: 1.3 },
      { label: 'Antwort', width: 1.3 },
      { label: 'Ergebnis', width: 1.4 },
      { label: 'Rückmeldung des Kunden', width: 4 },
    ],
    rounds.map((r) => [
      String(r.round_no),
      isoDe(r.requested_at),
      r.responded_at ? isoDe(r.responded_at) : '–',
      r.result === 'freigegeben'
        ? { text: 'freigegeben', color: COLOR.success }
        : r.result === 'korrektur'
          ? { text: 'Korrektur', color: COLOR.warning }
          : { text: 'offen', color: COLOR.muted },
      r.feedback ?? '',
    ]),
    'Es wurde noch keine Freigabe angefragt.',
  );
  const checks = listQualityChecks(db, projectId).filter((q) => q.stage === 'endkontrolle').reverse();
  pdf.h2('Qualitätsprüfung');
  pdf.table(
    [
      { label: 'Datum', width: 1.3 },
      { label: 'Video', width: 3 },
      { label: 'Urteil', width: 1.3 },
      { label: 'Ergebnis', width: 3.1 },
    ],
    checks.map((q) => [
      isoDe(q.created_at),
      q.video_name,
      q.verdict === 'freigegeben' ? { text: 'bestanden', color: COLOR.success } : q.verdict === 'zurueck' ? { text: 'zurück', color: COLOR.warning } : 'offen',
      q.summary ?? (q.issues.length ? q.issues.map((i) => (i.t ? `${i.t} ${i.text}` : i.text)).join('; ') : ''),
    ]),
    'Keine Endkontrolle erfasst.',
  );
  pdf.h2('Veröffentlichungen');
  pdf.table(
    [
      { label: 'Plattform', width: 1.6 },
      { label: 'Datum', width: 1.4 },
      { label: 'Status', width: 1.4 },
      { label: 'Link', width: 3.6 },
    ],
    p.publications.map((x) => [
      PLATFORM_LABELS[x.platform],
      `${dateDe(x.planned_date)}${x.planned_time ? `, ${x.planned_time}` : ''}`,
      x.status === 'veroeffentlicht' ? { text: 'veröffentlicht', color: COLOR.success } : 'geplant',
      x.post_url ? { text: x.post_url.replace(/^https?:\/\//, ''), link: x.post_url } : '',
    ]),
    'Noch keine Veröffentlichung geplant.',
  );
  return { file: pdfFileName('Freigabe-Protokoll', c.company_name, p.title), pdf: await pdf.finish() };
}

// ---------------------------------------------------------------------
// Briefing
// ---------------------------------------------------------------------

export async function briefingPdf(db: Database, data: BriefingData): Promise<{ file: string; pdf: Buffer }> {
  const pdf = new Pdf(agencyName(db), 'Briefing', longDate(data.date));
  pdf.para(data.summary, { size: 11.5 });
  pdf.h2('Termine heute');
  pdf.bullets(
    data.appointments.map((a) => ({ text: `${a.time ?? 'ganztägig'}  ${a.title}`, meta: a.location ?? undefined, color: COLOR.accent })),
    'Keine Termine.',
  );
  pdf.h2('Fällig und überfällig');
  pdf.bullets(
    [
      ...data.overdue.map((x) => ({ text: `${x.title}${x.customer ? ` (${x.customer})` : ''}`, meta: `seit ${tage(x.days)}`, color: COLOR.danger })),
      ...data.due_today.map((x) => ({ text: `${x.title}${x.customer ? ` (${x.customer})` : ''}`, meta: 'heute', color: COLOR.warning })),
    ],
    'Nichts fällig.',
  );
  pdf.h2('Warten auf Freigabe');
  pdf.bullets(
    data.approvals.map((a) => ({ text: `${a.title} (${a.customer})`, meta: `seit ${tage(a.waiting_days)}${a.follow_up ? ', nachfassen' : ''}`, color: a.follow_up ? COLOR.warning : COLOR.accent })),
    'Keine offenen Freigaben.',
  );
  pdf.h2('Drehtage der nächsten 7 Tage');
  pdf.bullets(
    data.shoots.map((s) => ({ text: `${dateDe(s.date)}${s.time ? `, ${s.time}` : ''}  ${s.title} (${s.customer})`, meta: s.location ?? undefined })),
    'Keine Drehtage geplant.',
  );
  if (data.packages.length) {
    pdf.h2(`Paketverbrauch ${monthDe(data.packages[0].month)}`);
    pdf.table(
      [
        { label: 'Kunde', width: 3 },
        { label: 'Stand', width: 3 },
        { label: 'Hinweis', width: 1.5 },
      ],
      data.packages.map((p) => [
        p.customer,
        p.items.map((i) => `${i.used} von ${i.quantity} × ${i.type}`).join(', '),
        p.status === 'rueckstand' ? { text: 'Rückstand', color: COLOR.danger } : p.status === 'ueber' ? { text: 'über Paket', color: COLOR.warning } : '',
      ]),
    );
  }
  pdf.h2('Warnungen');
  pdf.bullets(
    data.warnings.map((w) => ({ text: w.text, color: w.level === 'hoch' ? COLOR.danger : COLOR.warning })),
    'Keine Engpässe erkannt.',
  );
  return { file: pdfFileName('Briefing', data.date), pdf: await pdf.finish() };
}
