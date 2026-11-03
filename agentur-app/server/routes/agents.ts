// REST-API für die Claude-Agenten: Kontext, Aufträge, Prüfergebnisse.
import { Router } from 'express';
import type { Database } from '../db/database.ts';
import type { AppConfig } from '../env.ts';
import type { Services } from '../google/index.ts';
import { handle, HttpError, parse, parseId } from '../lib/http.ts';
import { agentContext, agentPrompt, deleteQualityCheck, listQualityChecks, recordQualityCheck } from '../services/agents.ts';
import { qualityCheckInput, type AgentKind } from '../../shared/schemas.ts';

const KINDS: AgentKind[] = ['videoschnitt', 'endkontrolle', 'highlight', 'pdf'];

export function agentRouter(db: Database, config: AppConfig, services: Services): Router {
  const r = Router();

  r.get('/projects/:id/agent-context', handle((req) => agentContext(db, config, services, parseId(req.params.id))));

  r.get(
    '/projects/:id/agent-prompt',
    handle((req) => {
      const kind = String(req.query.kind ?? 'videoschnitt') as AgentKind;
      if (!KINDS.includes(kind)) throw new HttpError(400, 'Unbekannter Agent');
      const dauer = req.query.dauer === undefined || req.query.dauer === '' ? undefined : Number(req.query.dauer);
      if (dauer !== undefined && (!Number.isFinite(dauer) || dauer < 5 || dauer > 600)) {
        throw new HttpError(400, 'Länge des Highlight-Reels bitte zwischen 5 und 600 Sekunden angeben');
      }
      return { prompt: agentPrompt(db, config, services, parseId(req.params.id), kind, { dauer }) };
    }),
  );

  r.get('/projects/:id/quality-checks', handle((req) => listQualityChecks(db, parseId(req.params.id))));

  r.post(
    '/projects/:id/quality-checks',
    handle((req, res) => {
      res.status(201);
      return recordQualityCheck(db, parseId(req.params.id), parse(qualityCheckInput, req.body));
    }),
  );

  r.delete(
    '/quality-checks/:id',
    handle((req) => {
      const projectId = deleteQualityCheck(db, parseId(req.params.id));
      return listQualityChecks(db, projectId);
    }),
  );

  return r;
}
