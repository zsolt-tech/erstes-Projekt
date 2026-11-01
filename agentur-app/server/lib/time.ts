// Datums- und Zeitfunktionen, immer bezogen auf die Zeitzone Europe/Berlin.
export const TIME_ZONE = 'Europe/Berlin';

const partsFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface BerlinParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function berlinParts(date: Date = new Date()): BerlinParts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(date)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Heutiges Datum in Berlin als YYYY-MM-DD */
export function todayBerlin(date: Date = new Date()): string {
  const p = berlinParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Aktueller Monat in Berlin als YYYY-MM */
export function monthBerlin(date: Date = new Date()): string {
  const p = berlinParts(date);
  return `${p.year}-${pad(p.month)}`;
}

/** Uhrzeit in Berlin als HH:MM */
export function timeBerlin(date: Date = new Date()): string {
  const p = berlinParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Zeitstempel für Dateinamen: YYYY-MM-DD_HH-MM-SS (Berlin) */
export function fileStampBerlin(date: Date = new Date()): string {
  const p = berlinParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}_${pad(p.hour)}-${pad(p.minute)}-${pad(p.second)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Erster und letzter Tag eines Monats (YYYY-MM) */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${pad(last)}` };
}
