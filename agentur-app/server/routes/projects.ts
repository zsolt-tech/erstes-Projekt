// REST-API für Projekte, Phasen, Checklisten, Freigaben, Veröffentlichungen, Vorlagen und Aufgaben.
import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import { events } from '../lib/events.ts';
import { handle, HttpError, parse, parseId, queryString } from '../lib/http.ts';
import * as projects from '../services/projects.ts';
import * as tasks from '../services/tasks.ts';
import type { Services } from '../google/index.ts';
import {
  approvalDecisionInput,
  approvalRequestInput,
  checklistCreateInput,
  checklistUpdateInput,
  invoiceInput,
  moveInput,
  phaseUpdateInput,
  projectCreateInput,
  projectUpdateInput,
  publicationInput,
  shootInput,
  taskInput,
  TASK_STATUSES,
  type Phase,
  type ProjectDetail,
} from '../../shared/schemas.ts';

const optionalId = (v: unknown) => (typeof v === 'string' && v ? parseId(v) : undefined);

export function projectRouter(db: Database, services: Services): Router {
  const r = Router();

  // Projektänderungen betreffen auch Paketverbrauch (Kunden) und Aufgaben
  const changed = (p: ProjectDetail) => {
    events.changed('projects', p.id);
    events.changed('customers', p.customer_id);
    events.changed('calendar');
    services.calendar.requestSync();
    return p;
  };

  // --- Vorlagen ---
  r.get('/project-templates', handle(() => projects.listTemplates(db)));

  // --- Projekte ---
  r.get(
    '/projects',
    handle((req) => {
      const scope = (req.query.scope as string) || 'offen';
      if (!['offen', 'abgeschlossen', 'abgebrochen', 'alle'].includes(scope)) throw new HttpError(400, 'Ungültiger Filter');
      return projects.listProjects(db, {
        customer_id: optionalId(req.query.customer_id),
        scope: scope as projects.ProjectFilter['scope'],
        q: queryString(req.query.q),
      });
    }),
  );

  r.get('/projects/:id', handle((req) => projects.getProject(db, parseId(req.params.id))));

  r.post(
    '/projects',
    handle((req, res) => {
      res.status(201);
      const p = changed(projects.createProject(db, parse(projectCreateInput, req.body)));
      services.drive.onProjectCreated(p.id);
      return p;
    }),
  );

  r.put(
    '/projects/:id',
    handle((req) => changed(projects.updateProject(db, parseId(req.params.id), parse(projectUpdateInput, req.body)))),
  );

  r.put(
    '/projects/:id/invoice',
    handle((req) => changed(projects.updateInvoice(db, parseId(req.params.id), parse(invoiceInput, req.body)))),
  );

  r.delete(
    '/projects/:id',
    handle((req) => {
      const id = parseId(req.params.id);
      const p = projects.getProject(db, id);
      projects.deleteProject(db, id);
      changed(p);
      events.changed('tasks');
      return undefined;
    }),
  );

  r.post(
    '/projects/:id/move',
    handle((req) => {
      const data = parse(moveInput, req.body);
      return changed(projects.moveProject(db, parseId(req.params.id), data.to_phase as Phase, data.reason));
    }),
  );

  r.post('/projects/:id/complete', handle((req) => changed(projects.completeProject(db, parseId(req.params.id)))));
  r.post('/projects/:id/reopen', handle((req) => changed(projects.reopenProject(db, parseId(req.params.id)))));

  r.put(
    '/projects/:id/phases/:phase',
    handle((req) => {
      const phase = Number(req.params.phase);
      if (!Number.isInteger(phase) || phase < 1 || phase > 5) throw new HttpError(400, 'Ungültige Phase');
      return changed(projects.updatePhase(db, parseId(req.params.id), phase, parse(phaseUpdateInput, req.body)));
    }),
  );

  r.put(
    '/projects/:id/shoot',
    handle((req) => changed(projects.updateShoot(db, parseId(req.params.id), parse(shootInput, req.body)))),
  );

  // --- Checklisten ---
  r.post(
    '/projects/:id/checklist',
    handle((req, res) => {
      res.status(201);
      return changed(projects.addChecklistItem(db, parseId(req.params.id), parse(checklistCreateInput, req.body)));
    }),
  );
  r.patch(
    '/checklist/:id',
    handle((req) => changed(projects.updateChecklistItem(db, parseId(req.params.id), parse(checklistUpdateInput, req.body)))),
  );
  r.delete('/checklist/:id', handle((req) => changed(projects.deleteChecklistItem(db, parseId(req.params.id)))));

  // --- Freigabe ---
  r.post(
    '/projects/:id/approval',
    handle((req) => changed(projects.decideApproval(db, parseId(req.params.id), parse(approvalDecisionInput, req.body)))),
  );
  r.put(
    '/projects/:id/approval',
    handle((req) =>
      changed(projects.setApprovalRequestDate(db, parseId(req.params.id), parse(approvalRequestInput, req.body).requested_date)),
    ),
  );

  // --- Veröffentlichungen ---
  r.post(
    '/projects/:id/publications',
    handle((req, res) => {
      res.status(201);
      return changed(projects.addPublication(db, parseId(req.params.id), parse(publicationInput, req.body)));
    }),
  );
  r.put(
    '/publications/:id',
    handle((req) => changed(projects.updatePublication(db, parseId(req.params.id), parse(publicationInput, req.body)))),
  );
  r.delete('/publications/:id', handle((req) => changed(projects.deletePublication(db, parseId(req.params.id)))));

  // --- Aufgaben ---
  r.get(
    '/tasks',
    handle((req) => {
      const status = (req.query.status as string) || 'offen';
      if (!['offen', 'erledigt', 'alle'].includes(status)) throw new HttpError(400, 'Ungültiger Filter');
      const range = req.query.range as string | undefined;
      if (range && !['ueberfaellig', 'heute', 'woche'].includes(range)) throw new HttpError(400, 'Ungültiger Zeitraum');
      return tasks.listTasks(db, {
        status: status as tasks.TaskFilter['status'],
        customer_id: optionalId(req.query.customer_id),
        project_id: optionalId(req.query.project_id),
        range: range as tasks.TaskFilter['range'],
      });
    }),
  );
  r.post(
    '/tasks',
    handle((req, res) => {
      const t = tasks.createTask(db, parse(taskInput, req.body));
      events.changed('tasks', t.id);
      events.changed('calendar');
      res.status(201);
      return t;
    }),
  );
  r.put(
    '/tasks/:id',
    handle((req) => {
      const t = tasks.updateTask(db, parseId(req.params.id), parse(taskInput, req.body));
      events.changed('tasks', t.id);
      events.changed('calendar');
      return t;
    }),
  );
  r.patch(
    '/tasks/:id',
    handle((req) => {
      const { status } = parse(z.object({ status: z.enum(TASK_STATUSES) }), req.body);
      const t = tasks.setTaskStatus(db, parseId(req.params.id), status);
      events.changed('tasks', t.id);
      events.changed('calendar');
      return t;
    }),
  );
  r.delete(
    '/tasks/:id',
    handle((req) => {
      tasks.deleteTask(db, parseId(req.params.id));
      events.changed('tasks');
      return undefined;
    }),
  );

  return r;
}
