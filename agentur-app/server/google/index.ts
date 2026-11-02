// Bündelt die Google-Dienste, damit Server, Zeitplaner und Tests dieselben Instanzen nutzen.
import type { Database } from '../db/database.ts';
import type { AppConfig } from '../env.ts';
import { GoogleClient } from './client.ts';
import { DriveService } from './drive.ts';
import { CalendarService } from './calendar.ts';
import { SyncQueue } from './queue.ts';

export interface Services {
  google: GoogleClient;
  queue: SyncQueue;
  drive: DriveService;
  calendar: CalendarService;
}

export function createServices(db: Database, config: AppConfig): Services {
  const google = new GoogleClient(db, config);
  const queue = new SyncQueue(db, google);
  const drive = new DriveService(db, google, queue);
  const calendar = new CalendarService(db, config, google, queue);
  return { google, queue, drive, calendar };
}
