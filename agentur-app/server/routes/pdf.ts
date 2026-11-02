// PDF-Downloads: Monatsbericht, Drehplan, Freigabe-Protokoll, Briefing.
import { Router, type Response } from 'express';
import type { Database } from '../db/database.ts';
import type { Services } from '../google/index.ts';
import { handle, HttpError, parseId } from '../lib/http.ts';
import { monthBerlin, todayBerlin } from '../lib/time.ts';
import { approvalProtocol, briefingPdf, monthlyReport, shootPlan } from '../services/pdf.ts';

function send(res: Response, result: { file: string; pdf: Buffer }, download: boolean) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${result.file}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(result.pdf);
}

export function pdfRouter(db: Database, services: Services): Router {
  const r = Router();
  const dl = (q: unknown) => q === '1';

  r.get(
    '/customers/:id/report.pdf',
    handle(async (req, res) => {
      const month = typeof req.query.month === 'string' && req.query.month ? req.query.month : monthBerlin();
      send(res, await monthlyReport(db, parseId(req.params.id), month), dl(req.query.download));
    }),
  );

  r.get('/projects/:id/drehplan.pdf', handle(async (req, res) => send(res, await shootPlan(db, parseId(req.params.id)), dl(req.query.download))));
  r.get('/projects/:id/freigabe.pdf', handle(async (req, res) => send(res, await approvalProtocol(db, parseId(req.params.id)), dl(req.query.download))));

  r.get(
    '/briefing/pdf',
    handle(async (req, res) => {
      const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : todayBerlin();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Datum im Format JJJJ-MM-TT erwartet');
      const data = services.briefing.get(date)?.data ?? (date === todayBerlin() ? services.briefing.build(date) : null);
      if (!data) throw new HttpError(404, 'Für diesen Tag gibt es kein Briefing');
      send(res, await briefingPdf(db, data), dl(req.query.download));
    }),
  );

  return r;
}
