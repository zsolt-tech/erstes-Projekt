// Startpunkt des Servers.
import fs from 'node:fs';
import { loadConfig } from './env.ts';
import { Database } from './db/database.ts';
import { migrate } from './db/migrate.ts';
import { seed } from './db/seed.ts';
import { createApp } from './app.ts';
import { startScheduler } from './jobs/scheduler.ts';
import { createServices } from './google/index.ts';

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });

const db = new Database(config.dbFile);
const applied = migrate(db);
if (applied.length) console.log(`[Datenbank] Migration(en) eingespielt: ${applied.join(', ')}`);
seed(db);

const services = createServices(db, config);
const app = createApp(db, config, services);
const scheduler = startScheduler(db, config, services);

const server = app.listen(config.port, config.host, () => {
  console.log(`[Server] Agentur-Verwaltung läuft unter http://localhost:${config.port}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Server] Port ${config.port} ist belegt. Läuft die App schon? Sonst PORT in der .env ändern.`);
  } else {
    console.error('[Server]', err);
  }
  process.exit(1);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('[Server] wird beendet ...');
  scheduler.stop();
  void services.queue.stop();
  server.close();
  // Offene Live-Verbindungen (Server-Sent Events) nicht abwarten
  server.closeAllConnections();
  db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
