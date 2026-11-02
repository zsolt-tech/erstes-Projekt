// REST-API für Briefing, Benachrichtigungen und Engpässe.
import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import type { Services } from '../google/index.ts';
import { handle, HttpError, parse, parseId } from '../lib/http.ts';
import { todayBerlin } from '../lib/time.ts';
import { detectBottlenecks } from '../services/bottlenecks.ts';
import { listNotifications, markRead } from '../services/notify.ts';

export function briefingRouter(db: Database, { briefing }: Services): Router {
  const r = Router();

  // Heutiges Briefing; vor der Briefing-Uhrzeit eine Vorschau mit dem aktuellen Stand
  r.get(
    '/briefing/today',
    handle(() => {
      const stored = briefing.get(todayBerlin());
      return { briefing: stored, preview: stored ? null : briefing.build() };
    }),
  );

  r.get('/briefings', handle(() => briefing.list()));

  r.get(
    '/briefings/:date',
    handle((req) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) throw new HttpError(400, 'Datum im Format JJJJ-MM-TT erwartet');
      const b = briefing.get(req.params.date);
      if (!b) throw new HttpError(404, 'Für diesen Tag gibt es kein Briefing');
      return b;
    }),
  );

  r.post(
    '/briefing/generate',
    handle((req) => {
      const { deliver } = parse(z.object({ deliver: z.boolean().default(true) }), req.body ?? {});
      return briefing.generate({ deliver });
    }),
  );

  r.get('/bottlenecks', handle(() => detectBottlenecks(db)));

  // --- Benachrichtigungen ---
  r.get('/notifications', handle(() => listNotifications(db)));
  r.post(
    '/notifications/read-all',
    handle(() => {
      markRead(db);
      return listNotifications(db);
    }),
  );
  r.post(
    '/notifications/:id/read',
    handle((req) => {
      markRead(db, parseId(req.params.id));
      return listNotifications(db);
    }),
  );

  return r;
}
