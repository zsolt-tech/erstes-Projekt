// Google Drive: Ordnerstruktur für Kunden und Projekte, Verknüpfung bestehender Ordner,
// Erkennung von Dateien im Ordner "Fertige Videos".
// Grundsatz: Die App legt nur Ordner an. Sie verschiebt, ändert und löscht nichts in Drive.
import type { Database } from '../db/database.ts';
import { HttpError } from '../lib/http.ts';
import { berlinParts, nowIso } from '../lib/time.ts';
import { events } from '../lib/events.ts';
import { getSetting, getSettings, setSetting } from '../services/settings.ts';
import { GoogleApiError, type GoogleClient } from './client.ts';
import type { SyncQueue } from './queue.ts';
import type { CustomerDrive, DriveFile, DriveFolder, DriveRole, ProjectDrive } from '../../shared/schemas.ts';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,mimeType,trashed,webViewLink,modifiedTime';

interface GFile {
  id: string;
  name: string;
  mimeType: string;
  trashed?: boolean;
  webViewLink?: string;
  modifiedTime?: string;
}

const PROJECT_ROLES = ['rohmaterial', 'schnitt', 'final', 'freigabe'] as const;

// Begriffe, an denen bestehende Unterordner beim Verknüpfen erkannt werden
const SYNONYMS: Record<(typeof PROJECT_ROLES)[number], string[]> = {
  rohmaterial: ['rohmaterial', 'footage', 'raw', 'rohdaten'],
  schnitt: ['entwurfe', 'entwuerfe', 'schnitt', 'in bearbeitung', 'bearbeitung', 'drafts'],
  final: ['fertige videos', 'final', 'finale videos', 'export', 'exporte', 'fertig'],
  freigabe: ['freigabe', 'zur freigabe', 'review'],
};

/** Vergleichbare Form eines Ordnernamens: ohne Nummern, Sonderzeichen und Umlaute */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[\d\s._·\-–]+/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ordner-ID aus einem Drive-Link oder direkt eingegebener ID */
export function parseFolderId(input: string): string {
  const s = input.trim();
  const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  throw new HttpError(400, 'Das sieht nicht nach einem Link zu einem Drive-Ordner aus. Bitte den Ordner in Drive öffnen und die Adresse aus der Browserzeile kopieren.');
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const folderUrl = (f: GFile) => f.webViewLink ?? `https://drive.google.com/drive/folders/${f.id}`;

export class DriveService {
  constructor(
    private db: Database,
    private google: GoogleClient,
    private queue: SyncQueue,
  ) {
    queue.register('drive.customer_folder', async (p) => {
      await this.ensureCustomerFolder(Number(p.customer_id));
    });
    queue.register('drive.project_folders', async (p) => {
      await this.ensureProjectFolders(Number(p.project_id));
    });
  }

  // ---------------------------------------------------------------------
  // Drive-Aufrufe
  // ---------------------------------------------------------------------

  private async list(query: string): Promise<GFile[]> {
    const files: GFile[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.google.request<{ files: GFile[]; nextPageToken?: string }>('GET', '/drive/v3/files', {
        query: {
          q: query,
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize: '200',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
          ...(pageToken ? { pageToken } : {}),
        },
      });
      files.push(...(res.files ?? []));
      pageToken = res.nextPageToken;
    } while (pageToken && files.length < 1000);
    return files;
  }

  private async getFile(id: string): Promise<GFile | null> {
    try {
      const f = await this.google.request<GFile>('GET', `/drive/v3/files/${encodeURIComponent(id)}`, {
        query: { fields: FILE_FIELDS, supportsAllDrives: 'true' },
      });
      return f.trashed ? null : f;
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 404) return null;
      throw err;
    }
  }

  private async createFolder(name: string, parentId: string): Promise<GFile> {
    return this.google.request<GFile>('POST', '/drive/v3/files', {
      query: { fields: FILE_FIELDS, supportsAllDrives: 'true' },
      body: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    });
  }

  /**
   * Unterordner suchen und nur anlegen, wenn es ihn noch nicht gibt (verhindert Doppelungen).
   * Mit owner: ein Ordner, der schon einem anderen Kunden oder Projekt gehört, wird nicht mitbenutzt
   * (z. B. zwei Kunden gleichen Namens); dann entsteht "Name (2)".
   */
  private async ensureChild(parentId: string, name: string, owner?: { customerId: number; projectId: number | null }): Promise<GFile> {
    for (let n = 1; n < 50; n++) {
      const candidate = n === 1 ? name : `${name} (${n})`;
      const found = await this.list(`'${q(parentId)}' in parents and name = '${q(candidate)}' and mimeType = '${FOLDER_MIME}' and trashed = false`);
      const free = owner ? found.filter((f) => !this.usedElsewhere(f.id, owner.customerId, owner.projectId)) : found;
      if (free[0]) return free[0];
      if (!found.length) return this.createFolder(candidate, parentId);
      // Der Name gehört schon einem anderen Kunden oder Projekt: mit dem nächsten Zusatz weiter
    }
    return this.createFolder(`${name} (${Date.now()})`, parentId);
  }

  private usedElsewhere(folderId: string, customerId: number, projectId: number | null): boolean {
    return !!this.db.get(
      `SELECT 1 FROM drive_folders WHERE google_folder_id = :f AND NOT (customer_id = :c AND COALESCE(project_id, 0) = :p)`,
      { f: folderId, c: customerId, p: projectId ?? 0 },
    );
  }

  // ---------------------------------------------------------------------
  // Zuordnungen in der Datenbank
  // ---------------------------------------------------------------------

  private mapping(customerId: number, projectId: number | null, role: DriveRole, year: number | null = null) {
    return this.db.get<DriveFolder>(
      `SELECT id, role, year, name, google_folder_id, web_url, origin FROM drive_folders
       WHERE customer_id = :c AND COALESCE(project_id, 0) = :p AND role = :role AND COALESCE(year, 0) = :y`,
      { c: customerId, p: projectId ?? 0, role, y: year ?? 0 },
    );
  }

  private saveMapping(
    customerId: number,
    projectId: number | null,
    role: DriveRole,
    file: GFile,
    origin: 'angelegt' | 'verknuepft',
    year: number | null = null,
  ) {
    this.db.run(
      `INSERT INTO drive_folders (customer_id, project_id, role, year, name, google_folder_id, web_url, origin)
       VALUES (:c, :p, :role, :y, :name, :gid, :url, :origin)
       ON CONFLICT (customer_id, COALESCE(project_id, 0), role, COALESCE(year, 0))
       DO UPDATE SET name = excluded.name, google_folder_id = excluded.google_folder_id, web_url = excluded.web_url,
         origin = excluded.origin, created_at = excluded.created_at`,
      { c: customerId, p: projectId, role, y: year, name: file.name, gid: file.id, url: folderUrl(file), origin },
    );
  }

  private customer(id: number) {
    const c = this.db.get<{ id: number; company_name: string; status: string }>(
      'SELECT id, company_name, status FROM customers WHERE id = ?',
      [id],
    );
    if (!c) throw new HttpError(404, 'Kunde nicht gefunden');
    return c;
  }

  private project(id: number) {
    const p = this.db.get<{ id: number; customer_id: number; title: string; service_month: string; created_at: string }>(
      'SELECT id, customer_id, title, service_month, created_at FROM projects WHERE id = ?',
      [id],
    );
    if (!p) throw new HttpError(404, 'Projekt nicht gefunden');
    return p;
  }

  // ---------------------------------------------------------------------
  // Ordnerstruktur anlegen
  // ---------------------------------------------------------------------

  /** Stammordner (z. B. "Kunden") in "Meine Ablage"; leerer Name = direkt in "Meine Ablage" */
  async ensureRoot(): Promise<string> {
    const name = getSettings(this.db).drive_root_folder.trim();
    if (!name) return 'root';
    const cached = getSetting<{ id: string; name: string } | null>(this.db, 'drive_root_folder_ref', null);
    if (cached && cached.name === name) {
      const f = await this.getFile(cached.id);
      if (f) return f.id;
    }
    const folder = await this.ensureChild('root', name);
    setSetting(this.db, 'drive_root_folder_ref', { id: folder.id, name });
    return folder.id;
  }

  async ensureCustomerFolder(customerId: number): Promise<DriveFolder> {
    const c = this.customer(customerId);
    const existing = this.mapping(customerId, null, 'kunde');
    if (existing) {
      const f = await this.getFile(existing.google_folder_id);
      if (f) return existing;
      if (existing.origin === 'verknuepft') {
        throw new Error('Der verknüpfte Kundenordner wurde in Drive nicht mehr gefunden. Bitte neu verknüpfen.');
      }
      this.db.run('DELETE FROM drive_folders WHERE customer_id = ? AND project_id IS NULL', [customerId]);
    }
    const root = await this.ensureRoot();
    const folder = await this.ensureChild(root, c.company_name, { customerId, projectId: null });
    for (const sub of getSettings(this.db).drive_customer_subfolders) await this.ensureChild(folder.id, sub);
    this.saveMapping(customerId, null, 'kunde', folder, 'angelegt');
    events.changed('customers', customerId);
    return this.mapping(customerId, null, 'kunde')!;
  }

  private async ensureYearFolder(customerId: number, year: number): Promise<GFile> {
    const existing = this.mapping(customerId, null, 'jahr', year);
    if (existing) {
      const f = await this.getFile(existing.google_folder_id);
      if (f) return f;
    }
    const customerFolder = this.mapping(customerId, null, 'kunde');
    if (!customerFolder) throw new Error('Kundenordner fehlt');
    const folder = await this.ensureChild(customerFolder.google_folder_id, String(year));
    this.saveMapping(customerId, null, 'jahr', folder, 'angelegt', year);
    return folder;
  }

  async ensureProjectFolders(projectId: number): Promise<void> {
    const p = this.project(projectId);
    const owner = { customerId: p.customer_id, projectId };
    const existing = this.mapping(p.customer_id, projectId, 'projekt');
    let folder = existing ? await this.getFile(existing.google_folder_id) : null;
    if (!folder) {
      if (!this.mapping(p.customer_id, null, 'kunde')) {
        throw new Error('Für diesen Kunden gibt es noch keinen Drive-Ordner. Bitte auf der Kundenseite anlegen oder verknüpfen.');
      }
      // Kundenordner prüfen (gelöscht oder im Papierkorb: neu anlegen bzw. Hinweis bei verknüpften Ordnern)
      await this.ensureCustomerFolder(p.customer_id);
      const year = Number(p.service_month.slice(0, 4)) || berlinParts().year;
      const yearFolder = await this.ensureYearFolder(p.customer_id, year);
      folder = await this.ensureChild(yearFolder.id, `${p.service_month} ${p.title}`, owner);
      this.saveMapping(p.customer_id, projectId, 'projekt', folder, 'angelegt');
    }
    // Verknüpfte Ordner bleiben, wie sie sind
    if (existing?.origin === 'verknuepft' && folder.id === existing.google_folder_id) return;
    // Unterordner auch dann ergänzen, wenn ein früherer Versuch mittendrin abgebrochen ist
    const names = getSettings(this.db).drive_subfolders;
    let changed = !existing;
    for (const [i, role] of PROJECT_ROLES.entries()) {
      const m = this.mapping(p.customer_id, projectId, role);
      if (m && (await this.getFile(m.google_folder_id))) continue;
      const sub = await this.ensureChild(folder.id, names[i], owner);
      this.saveMapping(p.customer_id, projectId, role, sub, 'angelegt');
      changed = true;
    }
    if (changed) events.changed('projects', projectId);
  }

  // ---------------------------------------------------------------------
  // Automatisch anlegen (nur wenn Google verbunden ist)
  // ---------------------------------------------------------------------

  /** Neuer Kunde oder Interessent wurde zum Kunden: Ordner anlegen */
  onCustomerBecameClient(customerId: number) {
    if (!this.google.connected || this.mapping(customerId, null, 'kunde')) return;
    const c = this.customer(customerId);
    this.queue.enqueue('drive.customer_folder', { customer_id: customerId, label: `Kundenordner „${c.company_name}“ anlegen` });
  }

  /** Neues Projekt: Ordner anlegen, sofern der Kunde schon einen Ordner hat oder er gerade angelegt wird */
  onProjectCreated(projectId: number) {
    if (!this.google.connected) return;
    const p = this.project(projectId);
    const customerReady =
      this.mapping(p.customer_id, null, 'kunde') || this.queue.pendingFor('drive.customer_folder', 'customer_id', p.customer_id);
    if (!customerReady) return;
    this.queue.enqueue('drive.project_folders', { project_id: projectId, label: `Projektordner „${p.title}“ anlegen` });
  }

  requestCustomerFolder(customerId: number) {
    const c = this.customer(customerId);
    if (!this.google.connected) throw new HttpError(409, 'Google ist nicht verbunden. Bitte zuerst in den Einstellungen verbinden.');
    this.queue.enqueue('drive.customer_folder', { customer_id: customerId, label: `Kundenordner „${c.company_name}“ anlegen` });
  }

  requestProjectFolders(projectId: number) {
    const p = this.project(projectId);
    if (!this.google.connected) throw new HttpError(409, 'Google ist nicht verbunden. Bitte zuerst in den Einstellungen verbinden.');
    if (!this.mapping(p.customer_id, null, 'kunde') && !this.queue.pendingFor('drive.customer_folder', 'customer_id', p.customer_id)) {
      throw new HttpError(409, 'Für diesen Kunden gibt es noch keinen Drive-Ordner. Bitte zuerst auf der Kundenseite anlegen oder verknüpfen.');
    }
    this.queue.enqueue('drive.project_folders', { project_id: projectId, label: `Projektordner „${p.title}“ anlegen` });
  }

  // ---------------------------------------------------------------------
  // Bestehende Ordner verknüpfen
  // ---------------------------------------------------------------------

  private async fetchFolder(url: string): Promise<GFile> {
    const id = parseFolderId(url);
    const f = await this.getFile(id);
    if (!f) throw new HttpError(404, 'Ordner nicht gefunden. Ist er im Papierkorb, oder gehört er zu einem anderen Google-Konto?');
    if (f.mimeType !== FOLDER_MIME) throw new HttpError(400, 'Der Link zeigt auf eine Datei, nicht auf einen Ordner.');
    return f;
  }

  async linkCustomerFolder(customerId: number, url: string): Promise<CustomerDrive> {
    this.customer(customerId);
    const f = await this.fetchFolder(url);
    this.db.transaction(() => {
      // Jahresordner gehörten zum bisherigen Kundenordner
      this.db.run("DELETE FROM drive_folders WHERE customer_id = ? AND project_id IS NULL AND role = 'jahr'", [customerId]);
      this.saveMapping(customerId, null, 'kunde', f, 'verknuepft');
    });
    // Projekte, die auf den Kundenordner gewartet haben, jetzt anlegen
    for (const p of this.db.all<{ id: number }>(
      `SELECT p.id FROM projects p WHERE p.customer_id = ? AND p.status IN ('aktiv','pausiert')
       AND NOT EXISTS (SELECT 1 FROM drive_folders d WHERE d.project_id = p.id AND d.role = 'projekt')
       AND p.created_at >= COALESCE((SELECT connected_at FROM google_accounts WHERE id = 1), '9999')`,
      [customerId],
    )) {
      this.onProjectCreated(p.id);
    }
    return this.customerDrive(customerId);
  }

  async linkProjectFolder(projectId: number, url: string): Promise<ProjectDrive> {
    const p = this.project(projectId);
    const f = await this.fetchFolder(url);
    const children = await this.list(`'${q(f.id)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`);
    const names = getSettings(this.db).drive_subfolders;
    this.db.transaction(() => {
      this.db.run('DELETE FROM drive_folders WHERE project_id = ?', [projectId]);
      this.saveMapping(p.customer_id, projectId, 'projekt', f, 'verknuepft');
      PROJECT_ROLES.forEach((role, i) => {
        const wanted = new Set([normalizeName(names[i]), ...SYNONYMS[role]]);
        const match = children.find((c) => wanted.has(normalizeName(c.name)));
        if (match) this.saveMapping(p.customer_id, projectId, role, match, 'verknuepft');
      });
    });
    await this.checkFinal(projectId).catch(() => undefined);
    return this.projectDrive(projectId);
  }

  unlinkCustomer(customerId: number) {
    this.db.run('DELETE FROM drive_folders WHERE customer_id = ? AND project_id IS NULL', [customerId]);
  }

  unlinkProject(projectId: number) {
    this.db.run('DELETE FROM drive_folders WHERE project_id = ?', [projectId]);
  }

  // ---------------------------------------------------------------------
  // Upload-Erkennung
  // ---------------------------------------------------------------------

  /** Zählt die Dateien im Ordner "Fertige Videos" und hakt den Checkpunkt ab, sobald dort etwas liegt */
  async checkFinal(projectId: number): Promise<ProjectDrive> {
    const p = this.project(projectId);
    const final = this.mapping(p.customer_id, projectId, 'final');
    if (!final) throw new HttpError(409, 'Für dieses Projekt ist kein Ordner „Fertige Videos“ verknüpft.');
    const files = await this.list(`'${q(final.google_folder_id)}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`);
    const list: DriveFile[] = files
      .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''))
      .slice(0, 50)
      .map((f) => ({ name: f.name, url: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`, modified_at: f.modifiedTime ?? null }));
    const now = nowIso();
    this.db.transaction(() => {
      this.db.run('UPDATE projects SET final_file_count = :n, final_checked_at = :now, final_files_json = :json WHERE id = :id', {
        id: projectId,
        n: files.length,
        now,
        json: JSON.stringify(list),
      });
      if (files.length > 0) {
        this.db.run(
          "UPDATE checklist_items SET is_done = 1, done_at = COALESCE(done_at, :now) WHERE project_id = :id AND auto_key = 'final_files_present' AND is_done = 0",
          { id: projectId, now },
        );
      }
    });
    events.changed('projects', projectId);
    return this.projectDrive(projectId);
  }

  /** Regelmäßige Prüfung aller laufenden Projekte in Bearbeitung, Upload und Freigabe */
  async checkAllFinal(): Promise<number> {
    if (!this.google.connected) return 0;
    const projects = this.db.all<{ id: number }>(
      `SELECT DISTINCT p.id FROM projects p JOIN drive_folders d ON d.project_id = p.id AND d.role = 'final'
       WHERE p.status = 'aktiv' AND p.current_phase BETWEEN 2 AND 4`,
    );
    for (const p of projects) await this.checkFinal(p.id);
    return projects.length;
  }

  // ---------------------------------------------------------------------
  // Anzeige
  // ---------------------------------------------------------------------

  customerDrive(customerId: number): CustomerDrive {
    this.customer(customerId);
    const folder = this.mapping(customerId, null, 'kunde') ?? null;
    if (folder) return { state: 'bereit', folder, error: null };
    const job = this.queue.pendingFor('drive.customer_folder', 'customer_id', customerId);
    if (job?.status === 'fehler') return { state: 'fehler', folder: null, error: job.last_error };
    if (job) return { state: 'wartet', folder: null, error: job.last_error };
    return { state: this.google.connected ? 'fehlt' : 'nicht_verbunden', folder: null, error: null };
  }

  projectDrive(projectId: number): ProjectDrive {
    const p = this.project(projectId);
    const extra = this.db.get<{ final_file_count: number | null; final_checked_at: string | null; final_files_json: string | null }>(
      'SELECT final_file_count, final_checked_at, final_files_json FROM projects WHERE id = ?',
      [projectId],
    )!;
    const folders = this.db.all<DriveFolder>(
      `SELECT id, role, year, name, google_folder_id, web_url, origin FROM drive_folders WHERE project_id = ?
       ORDER BY CASE role WHEN 'projekt' THEN 0 WHEN 'rohmaterial' THEN 1 WHEN 'schnitt' THEN 2 WHEN 'final' THEN 3 ELSE 4 END`,
      [projectId],
    );
    const base = {
      customer_folder: this.mapping(p.customer_id, null, 'kunde') ?? null,
      folders,
      final_file_count: extra.final_file_count,
      final_checked_at: extra.final_checked_at,
      final_files: extra.final_files_json ? (JSON.parse(extra.final_files_json) as DriveFile[]) : [],
    };
    const job = this.queue.pendingFor('drive.project_folders', 'project_id', projectId);
    // Während der Auftrag läuft, sind Unterordner evtl. erst teilweise angelegt
    if (job && job.status !== 'fehler') return { ...base, state: 'wartet', error: job.last_error };
    if (folders.length) return { ...base, state: 'bereit', error: null };
    if (job?.status === 'fehler') return { ...base, state: 'fehler', error: job.last_error };
    return { ...base, state: this.google.connected ? 'fehlt' : 'nicht_verbunden', error: null };
  }
}
