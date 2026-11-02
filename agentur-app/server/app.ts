// Express-Anwendung: API und Auslieferung der gebauten Oberfläche.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from './db/database.ts';
import type { AppConfig } from './env.ts';
import { errorHandler } from './lib/http.ts';
import { apiRouter } from './routes/api.ts';
import { createServices, type Services } from './google/index.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const stripBrackets = (host: string) => host.replace(/^\[|\]$/g, '');

function isLocalOrigin(origin: string): boolean {
  try {
    return LOCAL_HOSTS.has(stripBrackets(new URL(origin).hostname));
  } catch {
    return false;
  }
}

export function createApp(db: Database, config: AppConfig, services: Services = createServices(db, config)) {
  const app = express();
  app.disable('x-powered-by');
  // Nur Aufrufe über localhost annehmen (Schutz vor DNS-Rebinding, da die App kein Login hat)
  app.use((req, res, next) => {
    if (LOCAL_HOSTS.has(stripBrackets((req.headers.host ?? '').replace(/:\d+$/, '')))) return next();
    res.status(403).type('text/plain; charset=utf-8').send('Zugriff nur über http://localhost erlaubt.');
  });
  // Schutz vor fremden Webseiten im selben Browser: ändernde Aufrufe nur von der eigenen Oberfläche
  // (Browser senden bei solchen Aufrufen Origin bzw. Sec-Fetch-Site; curl und Agenten senden nichts davon)
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    const crossSite = req.headers['sec-fetch-site'] === 'cross-site' || (origin !== undefined && !isLocalOrigin(origin));
    if (crossSite) return res.status(403).json({ error: 'Aufruf von einer fremden Webseite abgelehnt' });
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', apiRouter(db, config, services));

  // Gebaute Oberfläche ausliefern; alle anderen Pfade landen bei der React-App
  const indexFile = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .type('text/plain; charset=utf-8')
        .send('Die Oberfläche ist noch nicht gebaut. Bitte "npm start" verwenden oder "npm run build" ausführen.');
    });
  }

  app.use(errorHandler);
  return app;
}
