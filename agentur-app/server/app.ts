// Express-Anwendung: API und Auslieferung der gebauten Oberfläche.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from './db/database.ts';
import type { AppConfig } from './env.ts';
import { errorHandler } from './lib/http.ts';
import { apiRouter } from './routes/api.ts';

export function createApp(db: Database, config: AppConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', apiRouter(db, config));

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
