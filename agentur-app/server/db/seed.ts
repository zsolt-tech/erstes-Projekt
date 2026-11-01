// Startdaten, die beim ersten Start angelegt werden.
import type { Database } from './database.ts';

const DEFAULT_DELIVERABLE_TYPES = ['Reel', 'Imagefilm', 'Post', 'Karussell', 'Story', 'Fotoshooting', 'Sonstiges'];

export function seed(db: Database): void {
  db.transaction(() => {
    const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM deliverable_types')!.n;
    if (count === 0) {
      DEFAULT_DELIVERABLE_TYPES.forEach((name, i) => {
        db.run('INSERT INTO deliverable_types (name, sort_order) VALUES (:name, :sort)', { name, sort: i * 10 });
      });
    }
  });
}
