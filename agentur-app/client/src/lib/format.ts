// Deutsche Formatierung von Datum, Geld und Größen.

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const longDateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
const euroFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** YYYY-MM-DD oder ISO-Zeitstempel -> TT.MM.JJJJ */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateFmt.format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : `${dateTimeFmt.format(d)} Uhr`;
}

export function formatLongDate(d: Date = new Date()): string {
  return longDateFmt.format(d);
}

/** YYYY-MM -> "November 2026"; unvollständige Eingaben (z. B. beim Tippen) bleiben, wie sie sind */
export function formatMonth(month: string): string {
  const d = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? new Date(`${month}-15T12:00:00`) : null;
  return d && !Number.isNaN(d.getTime()) ? monthFmt.format(d) : month;
}

const berlinDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Zeitpunkt (ISO, UTC) -> Kalenderdatum in Berliner Zeit "YYYY-MM-DD" */
export function berlinDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : berlinDateFmt.format(d);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatEuro(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return euroFmt.format(cents / 100);
}

/** Cent -> Eingabetext "890,00" */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** Eingabetext "1.234,50", "1.500" oder "1234.5" -> Cent; leer -> null; ungültig -> NaN */
export function inputToCents(text: string): number | null {
  const t = text.trim().replace(/\s|€/g, '');
  if (!t) return null;
  // Deutsche Schreibweise: Punkt als Tausendertrenner ("1.500" = 1500 Euro), Komma als Dezimaltrenner
  const normalized = t.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** Link ohne Protokoll für die Anzeige */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}
