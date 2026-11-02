// Google-Anbindung: Anmeldung (OAuth 2.0), Token-Verwaltung und Aufrufe der Google-Schnittstellen.
// Bewusst ohne die große googleapis-Bibliothek: Drive und Calendar sind einfache REST-Schnittstellen.
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Database } from '../db/database.ts';
import type { AppConfig } from '../env.ts';
import { HttpError } from '../lib/http.ts';
import { nowIso } from '../lib/time.ts';
import { getSetting, setSetting } from '../services/settings.ts';
import { decrypt, encrypt } from './crypto.ts';
import type { GoogleStatus } from '../../shared/schemas.ts';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.send',
];

export class GoogleApiError extends Error {
  /** Antwortstatus der App-API: Fehler bei Google bzw. Google nicht erreichbar */
  readonly httpStatus = 502;
  constructor(
    public status: number,
    message: string,
    public reason?: string,
  ) {
    super(message);
  }
}

/** Google ist nicht verbunden oder die Verbindung wurde widerrufen */
export class GoogleNotConnectedError extends Error {
  readonly httpStatus = 409;
  constructor(message = 'Google ist nicht verbunden. Bitte in den Einstellungen verbinden.') {
    super(message);
  }
}

interface AccountRow {
  email: string;
  refresh_token_enc: string;
  access_token_enc: string | null;
  token_expires_at: string | null;
  scopes: string;
  connected_at: string;
}

export class GoogleClient {
  private states = new Map<string, number>();
  private refreshing: Promise<string> | null = null;
  /** Konto vor der letzten Anmeldung (zum Erkennen eines Kontowechsels) */
  previousEmail: string | null = null;

  constructor(
    private db: Database,
    private config: AppConfig,
  ) {}

  get configured(): boolean {
    return !!(this.config.google.clientId && this.config.google.clientSecret);
  }

  private account(): AccountRow | undefined {
    return this.db.get<AccountRow>('SELECT * FROM google_accounts WHERE id = 1');
  }

  get connected(): boolean {
    return this.configured && !!this.account();
  }

  status(): GoogleStatus {
    const acc = this.account();
    return {
      configured: this.configured,
      connected: this.configured && !!acc,
      email: acc?.email ?? null,
      connected_at: acc?.connected_at ?? null,
      redirect_uri: this.config.google.redirectUri,
      missing_scopes: acc ? GOOGLE_SCOPES.filter((s) => s.startsWith('https') && !acc.scopes.split(' ').includes(s)) : [],
    };
  }

  // --- Zugangsdaten (Client-ID und Secret) ---

  /** Übernimmt die von Google heruntergeladene JSON-Datei und schreibt die Werte in die .env */
  saveCredentials(json: string): { client_id: string; redirect_uri_ok: boolean } {
    let parsed: { web?: Record<string, unknown>; installed?: Record<string, unknown> };
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new HttpError(400, 'Die Datei ist keine gültige JSON-Datei von Google.');
    }
    const data = parsed.web ?? parsed.installed;
    const clientId = typeof data?.client_id === 'string' ? data.client_id.trim() : '';
    const clientSecret = typeof data?.client_secret === 'string' ? data.client_secret.trim() : '';
    if (!clientId || !clientSecret) {
      throw new HttpError(400, 'In der Datei fehlen Client-ID oder Clientschlüssel. Bitte die Datei „JSON herunterladen“ aus der Google Cloud Console verwenden.');
    }
    if (!parsed.web) {
      throw new HttpError(400, 'Der Client hat den falschen Typ. Bitte in der Google Cloud Console einen Client vom Typ „Webanwendung“ anlegen.');
    }
    const uris = Array.isArray(data?.redirect_uris) ? (data!.redirect_uris as string[]) : [];
    this.writeEnv({ GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret });
    // Neuer Client: alte Verbindung passt nicht mehr
    if (clientId !== this.config.google.clientId) this.db.run('DELETE FROM google_accounts');
    this.config.google.clientId = clientId;
    this.config.google.clientSecret = clientSecret;
    return { client_id: clientId, redirect_uri_ok: uris.includes(this.config.google.redirectUri) };
  }

  private writeEnv(values: Record<string, string>) {
    let text = fs.existsSync(this.config.envFile) ? fs.readFileSync(this.config.envFile, 'utf8') : '';
    for (const [key, value] of Object.entries(values)) {
      const line = `${key}=${value}`;
      const re = new RegExp(`^${key}=.*$`, 'm');
      text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
    }
    fs.writeFileSync(this.config.envFile, text, { mode: 0o600 });
  }

  // --- Anmeldung ---

  authUrl(): string {
    if (!this.configured) throw new HttpError(400, 'Google-Zugangsdaten fehlen. Bitte zuerst die Datei von Google hochladen.');
    const state = crypto.randomBytes(16).toString('hex');
    this.states.set(state, Date.now() + 10 * 60 * 1000);
    const params = new URLSearchParams({
      client_id: this.config.google.clientId,
      redirect_uri: this.config.google.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${this.config.google.authUrl}?${params}`;
  }

  async handleCallback(code: string, state: string): Promise<string> {
    const expires = this.states.get(state);
    this.states.delete(state);
    if (!expires || expires < Date.now()) {
      throw new HttpError(400, 'Die Anmeldung ist abgelaufen. Bitte in den Einstellungen erneut „Mit Google verbinden“ wählen.');
    }
    const token = await this.tokenRequest({
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.google.redirectUri,
    });
    if (!token.refresh_token) {
      throw new HttpError(400, 'Google hat keinen dauerhaften Zugang erteilt. Bitte unter myaccount.google.com/permissions den Zugriff der App entfernen und erneut verbinden.');
    }
    const email = emailFromIdToken(token.id_token) ?? 'unbekannt';
    this.previousEmail = getSetting<string | null>(this.db, 'google_last_email', null) ?? this.account()?.email ?? null;
    if (email !== 'unbekannt') setSetting(this.db, 'google_last_email', email);
    const secret = this.config.appSecret;
    this.db.run(
      `INSERT INTO google_accounts (id, email, refresh_token_enc, access_token_enc, token_expires_at, scopes, connected_at)
       VALUES (1, :email, :refresh, :access, :expires, :scopes, :now)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, refresh_token_enc = excluded.refresh_token_enc,
         access_token_enc = excluded.access_token_enc, token_expires_at = excluded.token_expires_at,
         scopes = excluded.scopes, connected_at = excluded.connected_at`,
      {
        email,
        refresh: encrypt(token.refresh_token, secret),
        access: encrypt(token.access_token, secret),
        expires: new Date(Date.now() + (token.expires_in - 60) * 1000).toISOString(),
        scopes: token.scope ?? GOOGLE_SCOPES.join(' '),
        now: nowIso(),
      },
    );
    return email;
  }

  async disconnect(): Promise<void> {
    const acc = this.account();
    if (acc) {
      try {
        const refresh = decrypt(acc.refresh_token_enc, this.config.appSecret);
        await fetch(`${this.config.google.revokeUrl}?token=${encodeURIComponent(refresh)}`, {
          method: 'POST',
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        /* Widerruf ist optional; lokal wird trotzdem getrennt */
      }
    }
    this.db.run('DELETE FROM google_accounts');
  }

  private async tokenRequest(params: Record<string, string>) {
    const body = new URLSearchParams({
      client_id: this.config.google.clientId,
      client_secret: this.config.google.clientSecret,
      ...params,
    });
    let res: Response;
    try {
      res = await fetch(this.config.google.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new GoogleApiError(0, 'Google ist nicht erreichbar. Besteht eine Internetverbindung?');
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, string | number | undefined>;
    if (!res.ok) {
      const err = String(data.error ?? res.status);
      if (err === 'invalid_grant' && params.grant_type !== 'refresh_token') {
        // Anmeldecode abgelaufen oder schon benutzt: bestehende Verbindung bleibt
        throw new HttpError(400, 'Die Anmeldung bei Google ist abgelaufen. Bitte noch einmal auf „Mit Google verbinden“ klicken.');
      }
      if (err === 'invalid_grant') {
        // Zugang widerrufen oder abgelaufen: Verbindung lokal entfernen
        this.db.run('DELETE FROM google_accounts');
        throw new GoogleNotConnectedError('Die Google-Verbindung ist abgelaufen oder wurde widerrufen. Bitte in den Einstellungen neu verbinden.');
      }
      if (err === 'invalid_client') {
        throw new GoogleApiError(res.status, 'Google lehnt die Zugangsdaten ab (Client-ID oder Clientschlüssel falsch).', err);
      }
      throw new GoogleApiError(res.status, `Anmeldung bei Google fehlgeschlagen: ${data.error_description ?? err}`, err);
    }
    return data as unknown as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      scope?: string;
      id_token?: string;
    };
  }

  /** Gültiges Zugriffstoken, bei Bedarf erneuert */
  async accessToken(forceRefresh = false): Promise<string> {
    if (!this.configured) throw new GoogleNotConnectedError('Google-Zugangsdaten fehlen');
    const acc = this.account();
    if (!acc) throw new GoogleNotConnectedError();
    const secret = this.config.appSecret;
    const open = (enc: string) => {
      try {
        return decrypt(enc, secret);
      } catch {
        // z. B. Datenbank auf einen anderen Rechner kopiert oder APP_SECRET in der .env geändert
        this.db.run('DELETE FROM google_accounts');
        throw new GoogleNotConnectedError('Die gespeicherte Google-Verbindung lässt sich auf diesem Rechner nicht öffnen. Bitte in den Einstellungen neu verbinden.');
      }
    };
    if (!forceRefresh && acc.access_token_enc && acc.token_expires_at && acc.token_expires_at > nowIso()) {
      return open(acc.access_token_enc);
    }
    const refreshToken = open(acc.refresh_token_enc);
    // Gleichzeitige Anfragen teilen sich eine Erneuerung
    this.refreshing ??= (async () => {
      try {
        const token = await this.tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        });
        this.db.run('UPDATE google_accounts SET access_token_enc = :access, token_expires_at = :expires WHERE id = 1', {
          access: encrypt(token.access_token, secret),
          expires: new Date(Date.now() + (token.expires_in - 60) * 1000).toISOString(),
        });
        return token.access_token;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Aufruf einer Google-Schnittstelle mit JSON-Antwort */
  async request<T>(method: string, path: string, opts: { query?: Record<string, string | string[]>; body?: unknown } = {}): Promise<T> {
    const url = new URL(path, this.config.google.apiBase);
    for (const [k, v] of Object.entries(opts.query ?? {})) for (const item of [v].flat()) url.searchParams.append(k, item);
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(attempt > 0);
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(30000),
        });
      } catch {
        throw new GoogleApiError(0, 'Google ist nicht erreichbar. Besteht eine Internetverbindung?');
      }
      if (res.status === 401 && attempt === 0) continue; // Token erneuern und noch einmal
      if (res.status === 204) return undefined as T;
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
      if (!res.ok) {
        const reason = data.error?.errors?.[0]?.reason;
        throw new GoogleApiError(res.status, describeError(res.status, data.error?.message, reason), reason);
      }
      return data as T;
    }
    throw new GoogleNotConnectedError('Google lehnt den Zugriff ab. Bitte in den Einstellungen neu verbinden.');
  }
}

function describeError(status: number, message?: string, reason?: string): string {
  if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(message ?? '')) {
    return 'Die benötigte Google-Schnittstelle ist im Cloud-Projekt nicht aktiviert (siehe Anleitung, Schritt 2).';
  }
  if (reason === 'insufficientFilePermissions' || reason === 'forbidden' || /insufficient permissions for (the|this) (specified )?(parent|file)/i.test(message ?? '')) {
    return 'Für diesen Ordner oder Eintrag hat das Google-Konto nur Lesezugriff. Bitte einen Ordner mit Bearbeitungsrecht verknüpfen.';
  }
  if (status === 403 && (reason === 'insufficientPermissions' || /insufficient authentication scopes/i.test(message ?? ''))) {
    return 'Der App fehlt eine Berechtigung. Bitte in den Einstellungen die Google-Verbindung trennen und neu verbinden.';
  }
  if (status === 404) return 'Bei Google nicht gefunden (gelöscht oder kein Zugriff).';
  return `Google meldet einen Fehler (${status}): ${message ?? 'unbekannt'}`;
}

function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}
