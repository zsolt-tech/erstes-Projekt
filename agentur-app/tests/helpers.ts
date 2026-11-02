// Testhilfen: startet die App mit einer frischen Datenbank in einem temporären Ordner.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Database } from '../server/db/database.ts';
import { migrate } from '../server/db/migrate.ts';
import { seed } from '../server/db/seed.ts';
import { createApp } from '../server/app.ts';
import { loadConfig, type AppConfig } from '../server/env.ts';
import { createServices, type Services } from '../server/google/index.ts';

// In Tests keine echten Desktop-Benachrichtigungen
process.env.AGENTUR_NO_DESKTOP = '1';

export interface TestApp {
  db: Database;
  config: AppConfig;
  services: Services;
  url: string;
  dir: string;
  request: (method: string, url: string, body?: unknown) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

export async function startTestApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentur-test-'));
  const base = loadConfig();
  const config = loadConfig({
    dataDir: dir,
    dbFile: path.join(dir, 'test.sqlite'),
    backupDir: path.join(dir, 'backups'),
    backupExtraDir: null,
    clientDist: path.join(dir, 'kein-client'),
    envFile: path.join(dir, '.env'),
    appSecret: 'test-geheimnis',
    google: { ...base.google, clientId: '', clientSecret: '' },
    ...overrides,
  });
  const db = new Database(config.dbFile);
  migrate(db);
  seed(db);
  const services = createServices(db, config);
  const app = createApp(db, config, services);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    db,
    config,
    services,
    url,
    dir,
    async request(method, pathname, body) {
      const res = await fetch(url + pathname, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    async close() {
      await services.queue.stop();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
