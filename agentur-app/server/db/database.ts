// Schlanke Hülle um das in Node.js eingebaute SQLite (node:sqlite).
// Vorteil gegenüber Zusatzpaketen: Bei der Installation muss nichts kompiliert werden.
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type Row = Record<string, unknown>;
type Params = Record<string, unknown> | unknown[] | undefined;

const PARAM_RE = /[:@$]([A-Za-z_][A-Za-z0-9_]*)/g;

function toSqlValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  return v;
}

export class Database {
  readonly raw: DatabaseSync;
  private statements = new Map<string, { stmt: StatementSync; names: string[] }>();
  private txDepth = 0;

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    // Kleinschreibung auch für Umlaute und Akzente (SQLite selbst kennt nur A-Z), für die Suche
    this.raw.function('lower_de', { deterministic: true }, (v: unknown) => (v === null || v === undefined ? null : String(v).toLocaleLowerCase('de-DE')));
  }

  private prepare(sql: string) {
    let entry = this.statements.get(sql);
    if (!entry) {
      const names = [...new Set([...sql.matchAll(PARAM_RE)].map((m) => m[1]))];
      entry = { stmt: this.raw.prepare(sql), names };
      this.statements.set(sql, entry);
    }
    return entry;
  }

  private bind(entry: { names: string[] }, params: Params): unknown[] {
    if (params === undefined) return [];
    if (Array.isArray(params)) return params.map(toSqlValue);
    // Nur die Parameter übergeben, die im SQL vorkommen (node:sqlite lehnt zusätzliche ab)
    const obj: Record<string, unknown> = {};
    for (const name of entry.names) obj[name] = toSqlValue(params[name]);
    return [obj];
  }

  run(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
    const entry = this.prepare(sql);
    const r = entry.stmt.run(...(this.bind(entry, params) as never[]));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  get<T = Row>(sql: string, params?: Params): T | undefined {
    const entry = this.prepare(sql);
    return entry.stmt.get(...(this.bind(entry, params) as never[])) as T | undefined;
  }

  all<T = Row>(sql: string, params?: Params): T[] {
    const entry = this.prepare(sql);
    return entry.stmt.all(...(this.bind(entry, params) as never[])) as T[];
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Führt fn atomar aus. Verschachtelte Aufrufe nutzen Savepoints. */
  transaction<T>(fn: () => T): T {
    const depth = this.txDepth;
    const sp = `sp_${depth}`;
    this.raw.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.txDepth++;
    try {
      const result = fn();
      this.raw.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      return result;
    } catch (err) {
      this.raw.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    } finally {
      this.txDepth--;
    }
  }

  close(): void {
    this.statements.clear();
    this.raw.close();
  }
}
