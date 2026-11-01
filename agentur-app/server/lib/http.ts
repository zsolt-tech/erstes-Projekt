// Hilfsfunktionen für die REST-API: Fehler, Validierung, asynchrone Handler.
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Eintrag') => new HttpError(404, `${what} nicht gefunden`);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw result.error;
  return result.data;
}

export function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Ungültige ID');
  return id;
}

export const handle =
  (fn: (req: Request, res: Response) => unknown): RequestHandler =>
  async (req, res, next) => {
    try {
      const result = await fn(req, res);
      if (!res.headersSent) {
        if (result === undefined) res.status(204).end();
        else res.json(result);
      }
    } catch (err) {
      next(err);
    }
  };

// Einheitliche Fehlerantwort auf Deutsch
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.');
      if (!fields[key]) fields[key] = issue.message;
    }
    res.status(400).json({ error: err.issues[0]?.message || 'Ungültige Eingabe', fields });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  // Fehler mit eigener, für Nutzer verständlicher Meldung (z. B. Google-Anbindung)
  if (err instanceof Error && typeof (err as { httpStatus?: unknown }).httpStatus === 'number') {
    res.status((err as unknown as { httpStatus: number }).httpStatus).json({ error: err.message });
    return;
  }
  if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Ungültige Anfrage (JSON)' });
    return;
  }
  console.error('[Fehler]', err);
  res.status(500).json({ error: 'Interner Fehler. Details stehen im Server-Protokoll.' });
}
