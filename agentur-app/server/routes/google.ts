// REST-API für die Google-Verbindung, Drive-Ordner und die Warteschlange.
import { Router } from 'express';
import { z } from 'zod';
import type { Services } from '../google/index.ts';
import { events } from '../lib/events.ts';
import { handle, parse, parseId } from '../lib/http.ts';
import { calendarMoveInput, calendarSettingsInput, driveLinkInput } from '../../shared/schemas.ts';
import { HttpError } from '../lib/http.ts';

export function googleRouter({ google, queue, drive, calendar }: Services): Router {
  const r = Router();

  // --- Verbindung ---
  r.get('/google/status', handle(() => google.status()));

  r.post(
    '/google/credentials',
    handle((req) => {
      const { json } = parse(z.object({ json: z.string().min(2).max(20000) }), req.body);
      const result = google.saveCredentials(json);
      events.changed('google');
      return { ...result, status: google.status() };
    }),
  );

  // Browser wird zu Google weitergeleitet
  r.get('/google/auth', (_req, res, next) => {
    try {
      res.redirect(google.authUrl());
    } catch (err) {
      next(err);
    }
  });

  // Google leitet nach der Anmeldung hierher zurück
  r.get('/google/callback', async (req, res) => {
    const back = (params: Record<string, string>) => res.redirect(`/einstellungen?${new URLSearchParams(params)}`);
    if (req.query.error) {
      return back({ google: 'fehler', grund: req.query.error === 'access_denied' ? 'Zugriff wurde nicht erlaubt.' : String(req.query.error) });
    }
    try {
      const email = await google.handleCallback(String(req.query.code ?? ''), String(req.query.state ?? ''));
      events.changed('google');
      queue.kick();
      back({ google: 'verbunden', konto: email });
    } catch (err) {
      back({ google: 'fehler', grund: err instanceof Error ? err.message : 'Unbekannter Fehler' });
    }
  });

  r.post(
    '/google/disconnect',
    handle(async () => {
      await google.disconnect();
      events.changed('google');
      return google.status();
    }),
  );

  // --- Warteschlange ---
  r.get('/sync/jobs', handle(() => queue.list()));
  r.post(
    '/sync/jobs/:id/retry',
    handle((req) => {
      queue.retry(parseId(req.params.id));
      return queue.list();
    }),
  );

  // --- Kundenordner ---
  r.get('/customers/:id/drive', handle((req) => drive.customerDrive(parseId(req.params.id))));
  r.post(
    '/customers/:id/drive/create',
    handle((req) => {
      const id = parseId(req.params.id);
      drive.requestCustomerFolder(id);
      return drive.customerDrive(id);
    }),
  );
  r.post(
    '/customers/:id/drive/link',
    handle(async (req) => {
      const id = parseId(req.params.id);
      const result = await drive.linkCustomerFolder(id, parse(driveLinkInput, req.body).url);
      events.changed('customers', id);
      return result;
    }),
  );
  r.delete(
    '/customers/:id/drive',
    handle((req) => {
      const id = parseId(req.params.id);
      drive.unlinkCustomer(id);
      events.changed('customers', id);
      return drive.customerDrive(id);
    }),
  );

  // --- Projektordner ---
  r.get('/projects/:id/drive', handle((req) => drive.projectDrive(parseId(req.params.id))));
  r.post(
    '/projects/:id/drive/create',
    handle((req) => {
      const id = parseId(req.params.id);
      drive.requestProjectFolders(id);
      return drive.projectDrive(id);
    }),
  );
  r.post(
    '/projects/:id/drive/link',
    handle(async (req) => {
      const id = parseId(req.params.id);
      const result = await drive.linkProjectFolder(id, parse(driveLinkInput, req.body).url);
      events.changed('projects', id);
      return result;
    }),
  );
  r.post('/projects/:id/drive/check', handle((req) => drive.checkFinal(parseId(req.params.id))));
  r.delete(
    '/projects/:id/drive',
    handle((req) => {
      const id = parseId(req.params.id);
      drive.unlinkProject(id);
      events.changed('projects', id);
      return drive.projectDrive(id);
    }),
  );

  // --- Kalender ---
  const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

  r.get(
    '/calendar/items',
    handle((req) => {
      const { start, end } = req.query;
      if (!isDate(start) || !isDate(end)) throw new HttpError(400, 'Zeitraum fehlt (start und end als JJJJ-MM-TT)');
      const cid = typeof req.query.customer_id === 'string' && req.query.customer_id ? parseId(req.query.customer_id) : undefined;
      return calendar.items(start, end, cid);
    }),
  );

  r.post(
    '/calendar/move',
    handle((req) => {
      const d = parse(calendarMoveInput, req.body);
      calendar.move(d.id, d.start, d.all_day, d.end);
      return { ok: true };
    }),
  );

  r.get(
    '/calendar/settings',
    handle(async () => {
      if (google.connected) await calendar.refreshCalendarList().catch(() => undefined);
      return calendar.settings();
    }),
  );

  r.put(
    '/calendar/settings',
    handle((req) => {
      const result = calendar.updateSettings(parse(calendarSettingsInput, req.body));
      events.changed('calendar');
      return result;
    }),
  );

  r.post(
    '/calendar/sync',
    handle(async () => {
      if (!google.connected) throw new HttpError(409, 'Google ist nicht verbunden.');
      queue.enqueue('calendar.sync', { label: 'Kalender abgleichen' });
      await queue.process();
      return calendar.settings();
    }),
  );

  r.get('/projects/:id/calendar', handle((req) => calendar.shootCalendar(parseId(req.params.id))));
  r.post('/projects/:id/calendar/restore', handle((req) => calendar.restoreShoot(parseId(req.params.id))));

  return r;
}
