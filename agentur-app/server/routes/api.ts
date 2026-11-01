// REST-API der Etappe 1: Kunden, Einstellungen, Stammdaten, Datensicherung, Live-Ereignisse.
import { Router } from 'express';
import type { Database } from '../db/database.ts';
import type { AppConfig } from '../env.ts';
import { events } from '../lib/events.ts';
import { handle, HttpError, parse, parseId } from '../lib/http.ts';
import {
  createCustomer,
  getCustomer,
  listCustomers,
  setArchived,
  updateCustomer,
} from '../services/customers.ts';
import { backupOverview, runBackup } from '../services/backup.ts';
import { projectRouter } from './projects.ts';
import { googleRouter } from './google.ts';
import type { Services } from '../google/index.ts';
import { getSettings, updateSettings } from '../services/settings.ts';
import {
  createDeliverableType,
  createTeamMember,
  listDeliverableTypes,
  listTeam,
  updateDeliverableType,
  updateTeamMember,
} from '../services/masterdata.ts';
import {
  CUSTOMER_STATUSES,
  customerInput,
  deliverableTypeInput,
  settingsUpdate,
  teamMemberInput,
  type ChangeEvent,
  type CustomerStatus,
} from '../../shared/schemas.ts';

export function apiRouter(db: Database, config: AppConfig, services: Services): Router {
  const r = Router();

  r.get('/health', handle(() => ({ ok: true, app: 'agentur-verwaltung' })));

  // --- Live-Ereignisse (Server-Sent Events) ---
  r.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    const send = (e: ChangeEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    events.on('event', send);
    req.on('close', () => {
      clearInterval(ping);
      events.off('event', send);
    });
  });

  // --- Kunden ---
  r.get(
    '/customers',
    handle((req) => {
      const status = req.query.status as string | undefined;
      if (status && !CUSTOMER_STATUSES.includes(status as CustomerStatus)) {
        throw new HttpError(400, 'Unbekannter Status');
      }
      return listCustomers(db, {
        status: status as CustomerStatus | undefined,
        q: (req.query.q as string) || undefined,
        archived: req.query.archived === '1',
      });
    }),
  );

  r.get(
    '/customers/:id',
    handle((req) => {
      const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : undefined;
      return getCustomer(db, parseId(req.params.id), month);
    }),
  );

  r.post(
    '/customers',
    handle((req, res) => {
      const customer = createCustomer(db, parse(customerInput, req.body));
      events.changed('customers', customer.id);
      // Drive-Ordner automatisch, aber nicht für Interessenten
      if (customer.status !== 'interessent') services.drive.onCustomerBecameClient(customer.id);
      res.status(201);
      return customer;
    }),
  );

  r.put(
    '/customers/:id',
    handle((req) => {
      const id = parseId(req.params.id);
      const before = getCustomer(db, id);
      const customer = updateCustomer(db, id, parse(customerInput, req.body));
      events.changed('customers', customer.id);
      // Interessent wurde zum Kunden: jetzt den Drive-Ordner anlegen
      if (before.status === 'interessent' && customer.status !== 'interessent') services.drive.onCustomerBecameClient(customer.id);
      return customer;
    }),
  );

  r.post(
    '/customers/:id/archive',
    handle((req) => {
      const customer = setArchived(db, parseId(req.params.id), true);
      events.changed('customers', customer.id);
      return customer;
    }),
  );

  r.post(
    '/customers/:id/unarchive',
    handle((req) => {
      const customer = setArchived(db, parseId(req.params.id), false);
      events.changed('customers', customer.id);
      return customer;
    }),
  );

  // --- Einstellungen ---
  r.get('/settings', handle(() => getSettings(db)));
  r.put(
    '/settings',
    handle((req) => {
      const result = updateSettings(db, parse(settingsUpdate, req.body));
      events.changed('settings');
      return result;
    }),
  );

  // --- Leistungsarten ---
  r.get('/deliverable-types', handle(() => listDeliverableTypes(db)));
  r.post(
    '/deliverable-types',
    handle((req, res) => {
      const result = createDeliverableType(db, parse(deliverableTypeInput, req.body));
      events.changed('deliverable-types');
      res.status(201);
      return result;
    }),
  );
  r.put(
    '/deliverable-types/:id',
    handle((req) => {
      const result = updateDeliverableType(db, parseId(req.params.id), parse(deliverableTypeInput, req.body));
      events.changed('deliverable-types');
      return result;
    }),
  );

  // --- Team ---
  r.get('/team', handle(() => listTeam(db)));
  r.post(
    '/team',
    handle((req, res) => {
      const result = createTeamMember(db, parse(teamMemberInput, req.body));
      events.changed('team');
      res.status(201);
      return result;
    }),
  );
  r.put(
    '/team/:id',
    handle((req) => {
      const result = updateTeamMember(db, parseId(req.params.id), parse(teamMemberInput, req.body));
      events.changed('team');
      return result;
    }),
  );

  // --- Datensicherung ---
  r.get('/backups', handle(() => backupOverview(db, config)));
  r.post(
    '/backups',
    handle((_req, res) => {
      const result = runBackup(db, config);
      events.changed('backups');
      res.status(201);
      return result;
    }),
  );

  r.use(projectRouter(db, services));
  r.use(googleRouter(services));

  r.use(() => {
    throw new HttpError(404, 'Unbekannte API-Adresse');
  });

  return r;
}
