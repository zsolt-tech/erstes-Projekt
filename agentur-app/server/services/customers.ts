// Kundenverwaltung: Lesen, Anlegen, Bearbeiten, Archivieren, Paketverbrauch.
import type { Database } from '../db/database.ts';
import { HttpError, notFound } from '../lib/http.ts';
import { monthBerlin, monthRange, nowIso, todayBerlin } from '../lib/time.ts';
import type {
  Contact,
  Customer,
  CustomerData,
  CustomerListItem,
  CustomerStatus,
  PackageItem,
  PackageUsage,
  SocialChannel,
} from '../../shared/schemas.ts';

export interface CustomerListFilter {
  status?: CustomerStatus;
  q?: string;
  archived?: boolean;
}

export function listCustomers(db: Database, filter: CustomerListFilter = {}): CustomerListItem[] {
  const today = todayBerlin();
  const where: string[] = [filter.archived ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL'];
  const params: Record<string, unknown> = { today };
  if (filter.status) {
    where.push('c.status = :status');
    params.status = filter.status;
  }
  if (filter.q && filter.q.trim()) {
    where.push(`(c.company_name LIKE :q OR c.industry LIKE :q OR c.city LIKE :q
      OR EXISTS (SELECT 1 FROM contacts x WHERE x.customer_id = c.id AND (x.name LIKE :q OR x.email LIKE :q OR x.phone LIKE :q)))`);
    params.q = `%${filter.q.trim()}%`;
  }
  return db.all<CustomerListItem>(
    `SELECT c.id, c.company_name, c.industry, c.customer_type, c.status, c.pipeline_stage, c.city,
            c.archived_at, c.updated_at,
            pc.name AS primary_contact_name, pc.phone AS primary_contact_phone, pc.email AS primary_contact_email,
            (SELECT GROUP_CONCAT(t.qty || ' × ' || t.name, ', ') FROM (
               SELECT SUM(pi.quantity_per_month) AS qty, dt.name AS name, MIN(dt.sort_order) AS so
               FROM package_items pi JOIN deliverable_types dt ON dt.id = pi.deliverable_type_id
               WHERE pi.customer_id = c.id AND pi.valid_from <= :today
                 AND (pi.valid_until IS NULL OR pi.valid_until >= :today)
               GROUP BY dt.id ORDER BY so) t) AS package_summary
     FROM customers c
     LEFT JOIN contacts pc ON pc.id = (
       SELECT id FROM contacts WHERE customer_id = c.id ORDER BY is_primary DESC, sort_order, id LIMIT 1)
     WHERE ${where.join(' AND ')}
     ORDER BY c.company_name COLLATE NOCASE`,
    params,
  );
}

/** Paketverbrauch eines Monats: gebuchte Menge je Leistungsart gegen angelegte Projekte. */
export function packageUsage(db: Database, customerId: number, month = monthBerlin()): PackageUsage[] {
  const { start, end } = monthRange(month);
  return db.all<PackageUsage>(
    `SELECT pi.deliverable_type_id, dt.name AS deliverable_type_name,
            SUM(pi.quantity_per_month) AS quantity,
            COALESCE((SELECT SUM(p.deliverable_count) FROM projects p
                      WHERE p.customer_id = :cid AND p.deliverable_type_id = pi.deliverable_type_id
                        AND p.service_month = :month AND p.status <> 'abgebrochen'), 0) AS used,
            COALESCE((SELECT SUM(p.deliverable_count) FROM projects p
                      WHERE p.customer_id = :cid AND p.deliverable_type_id = pi.deliverable_type_id
                        AND p.service_month = :month AND p.status = 'abgeschlossen'), 0) AS completed
     FROM package_items pi
     JOIN deliverable_types dt ON dt.id = pi.deliverable_type_id
     WHERE pi.customer_id = :cid AND pi.valid_from <= :end
       AND (pi.valid_until IS NULL OR pi.valid_until >= :start)
     GROUP BY pi.deliverable_type_id
     ORDER BY dt.sort_order, dt.name`,
    { cid: customerId, month, start, end },
  );
}

export function getCustomer(db: Database, id: number, month?: string): Customer {
  const c = db.get<Omit<Customer, 'contacts' | 'social_channels' | 'package_items' | 'package_usage'>>(
    'SELECT * FROM customers WHERE id = ?',
    [id],
  );
  if (!c) throw notFound('Kunde');
  const usageMonth = month || monthBerlin();
  return {
    ...c,
    contacts: db.all<Contact>('SELECT * FROM contacts WHERE customer_id = ? ORDER BY is_primary DESC, sort_order, id', [id]),
    social_channels: db.all<SocialChannel>('SELECT * FROM social_channels WHERE customer_id = ? ORDER BY id', [id]),
    package_items: db.all<PackageItem>(
      `SELECT pi.*, dt.name AS deliverable_type_name FROM package_items pi
       JOIN deliverable_types dt ON dt.id = pi.deliverable_type_id
       WHERE pi.customer_id = ? ORDER BY pi.valid_from DESC, dt.sort_order`,
      [id],
    ),
    package_usage: { month: usageMonth, items: packageUsage(db, id, usageMonth) },
  };
}

/**
 * Gleicht Kind-Einträge (Ansprechpartner, Kanäle, Paketzeilen) ab:
 * vorhandene IDs werden aktualisiert, neue angelegt, nicht mehr enthaltene gelöscht.
 */
function syncChildren<T extends { id?: number }>(
  db: Database,
  table: 'contacts' | 'social_channels' | 'package_items',
  customerId: number,
  items: T[],
  columns: (keyof T & string)[],
  extra: (item: T, index: number) => Record<string, unknown> = () => ({}),
) {
  const existing = new Set(
    db.all<{ id: number }>(`SELECT id FROM ${table} WHERE customer_id = ?`, [customerId]).map((r) => r.id),
  );
  const keep = new Set<number>();
  items.forEach((item, index) => {
    const values: Record<string, unknown> = { ...extra(item, index), customer_id: customerId };
    for (const col of columns) values[col] = item[col];
    const cols = Object.keys(values);
    if (item.id && existing.has(item.id)) {
      db.run(`UPDATE ${table} SET ${cols.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :id`, {
        ...values,
        id: item.id,
      });
      keep.add(item.id);
    } else {
      const r = db.run(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((k) => `:${k}`).join(', ')})`,
        values,
      );
      keep.add(r.lastInsertRowid);
    }
  });
  for (const id of existing) {
    if (!keep.has(id)) db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
  }
}

function checkDeliverableTypes(db: Database, data: CustomerData) {
  for (const p of data.package_items) {
    const exists = db.get('SELECT 1 FROM deliverable_types WHERE id = ?', [p.deliverable_type_id]);
    if (!exists) throw new HttpError(400, 'Unbekannte Leistungsart im Paket');
  }
}

function saveChildren(db: Database, customerId: number, data: CustomerData) {
  // Genau ein Hauptansprechpartner: der erste markierte, sonst der erste in der Liste
  const primaryIndex = Math.max(0, data.contacts.findIndex((c) => c.is_primary));
  syncChildren(db, 'contacts', customerId, data.contacts, ['name', 'role', 'phone', 'email'], (_c, i) => ({
    is_primary: i === primaryIndex ? 1 : 0,
    sort_order: i,
  }));
  syncChildren(db, 'social_channels', customerId, data.social_channels, ['platform', 'handle', 'url']);
  syncChildren(db, 'package_items', customerId, data.package_items, [
    'deliverable_type_id',
    'quantity_per_month',
    'monthly_price_cents',
    'valid_from',
    'valid_until',
  ]);
}

const BASE_COLUMNS = [
  'company_name',
  'industry',
  'customer_type',
  'status',
  'pipeline_stage',
  'lead_source',
  'next_contact_date',
  'street',
  'postal_code',
  'city',
  'country',
  'website',
  'notes',
  'approval_reminder_days',
] as const;

export function createCustomer(db: Database, data: CustomerData): Customer {
  checkDeliverableTypes(db, data);
  const now = nowIso();
  const values: Record<string, unknown> = {};
  for (const col of BASE_COLUMNS) values[col] = data[col];
  if (data.status === 'interessent') {
    values.pipeline_stage = data.pipeline_stage || 'erstkontakt';
  } else {
    values.pipeline_stage = null;
  }
  values.country = data.country || 'Deutschland';
  const id = db.transaction(() => {
    const cols = [...Object.keys(values), 'created_at', 'updated_at'];
    const r = db.run(
      `INSERT INTO customers (${cols.join(', ')}) VALUES (${cols.map((k) => `:${k}`).join(', ')})`,
      { ...values, created_at: now, updated_at: now },
    );
    saveChildren(db, r.lastInsertRowid, data);
    return r.lastInsertRowid;
  });
  return getCustomer(db, id);
}

export function updateCustomer(db: Database, id: number, data: CustomerData): Customer {
  const current = db.get<{ status: CustomerStatus; converted_at: string | null; pipeline_stage: string | null }>(
    'SELECT status, converted_at, pipeline_stage FROM customers WHERE id = ?',
    [id],
  );
  if (!current) throw notFound('Kunde');
  checkDeliverableTypes(db, data);
  const values: Record<string, unknown> = {};
  for (const col of BASE_COLUMNS) values[col] = data[col];
  values.converted_at = current.converted_at;
  if (data.status === 'interessent') {
    values.pipeline_stage = data.pipeline_stage || current.pipeline_stage || 'erstkontakt';
  } else if (current.status === 'interessent') {
    // Umwandlung eines Interessenten in einen Kunden
    values.pipeline_stage = 'gewonnen';
    values.converted_at = nowIso();
  } else {
    values.pipeline_stage = current.pipeline_stage === 'gewonnen' ? 'gewonnen' : null;
  }
  values.updated_at = nowIso();
  db.transaction(() => {
    db.run(`UPDATE customers SET ${Object.keys(values).map((k) => `${k} = :${k}`).join(', ')} WHERE id = :id`, {
      ...values,
      id,
    });
    saveChildren(db, id, data);
  });
  return getCustomer(db, id);
}

export function setArchived(db: Database, id: number, archived: boolean): Customer {
  const r = db.run('UPDATE customers SET archived_at = :at, updated_at = :now WHERE id = :id', {
    at: archived ? nowIso() : null,
    now: nowIso(),
    id,
  });
  if (r.changes === 0) throw notFound('Kunde');
  return getCustomer(db, id);
}
