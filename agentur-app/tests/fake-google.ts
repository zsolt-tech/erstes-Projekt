// Nachbildung der benötigten Google-Schnittstellen für Tests (Anmeldung und Drive).
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  modifiedTime: string;
}

const FOLDER = 'application/vnd.google-apps.folder';

export async function startFakeGoogle() {
  const files = new Map<string, FakeFile>();
  const stats = { refreshes: 0, creates: 0, revoked: false, failCreateNames: new Set<string>() };
  let seq = 0;
  let tokenSeq = 0;
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  const idToken = (email: string) =>
    ['e30', Buffer.from(JSON.stringify({ email })).toString('base64url'), 'sig'].join('.');

  app.post('/token', (req, res) => {
    if (req.body.client_secret !== 'geheim') return res.status(401).json({ error: 'invalid_client' });
    if (req.body.grant_type === 'authorization_code') {
      if (req.body.code !== 'gut') return res.status(400).json({ error: 'invalid_grant' });
      return res.json({
        access_token: `at${++tokenSeq}`,
        expires_in: 3600,
        refresh_token: 'rt1',
        scope: 'openid email https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send',
        id_token: idToken('inhaber@beispiel.de'),
      });
    }
    if (req.body.grant_type === 'refresh_token') {
      if (stats.revoked) return res.status(400).json({ error: 'invalid_grant' });
      stats.refreshes++;
      return res.json({ access_token: `at${++tokenSeq}`, expires_in: 3600 });
    }
    res.status(400).json({ error: 'unsupported_grant_type' });
  });
  app.post('/revoke', (_req, res) => res.status(200).end());
  // Anmeldeseite: bestätigt sofort und leitet zur App zurück
  app.get('/auth', (req, res) => {
    res.redirect(`${req.query.redirect_uri}?code=gut&state=${encodeURIComponent(String(req.query.state))}`);
  });

  const auth: express.RequestHandler = (req, res, next) => {
    if (!/^Bearer at\d+$/.test(req.headers.authorization ?? '')) return res.status(401).json({ error: { message: 'unauth' } });
    next();
  };

  // Sehr vereinfachte Auswertung der Drive-Suchsprache
  function matches(f: FakeFile, q: string): boolean {
    for (const clause of q.split(' and ').map((c) => c.trim())) {
      let m: RegExpExecArray | null;
      if ((m = /^'(.+)' in parents$/.exec(clause))) {
        if (!f.parents.includes(m[1])) return false;
      } else if ((m = /^name = '(.*)'$/.exec(clause))) {
        if (f.name !== m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')) return false;
      } else if ((m = /^mimeType (=|!=) '(.+)'$/.exec(clause))) {
        if ((f.mimeType === m[2]) !== (m[1] === '=')) return false;
      } else if (clause === 'trashed = false') {
        if (f.trashed) return false;
      } else {
        throw new Error(`Unbekannte Bedingung: ${clause}`);
      }
    }
    return true;
  }

  const out = (f: FakeFile) => ({ ...f, webViewLink: `https://drive.google.com/drive/folders/${f.id}` });

  app.get('/drive/v3/files', auth, (req, res) => {
    const q = String(req.query.q ?? '');
    res.json({ files: [...files.values()].filter((f) => matches(f, q)).map(out) });
  });
  app.get('/drive/v3/files/:id', auth, (req, res) => {
    const f = files.get(req.params.id);
    if (!f) return res.status(404).json({ error: { message: 'File not found', errors: [{ reason: 'notFound' }] } });
    res.json(out(f));
  });
  app.post('/drive/v3/files', auth, (req, res) => {
    if (stats.failCreateNames.has(req.body.name)) return res.status(500).json({ error: { message: 'Backend Error' } });
    stats.creates++;
    const f = add(req.body.name, req.body.mimeType, req.body.parents?.[0] ?? 'root');
    res.json(out(f));
  });

  function add(name: string, mimeType: string, parent: string): FakeFile {
    const f: FakeFile = { id: `id${String(++seq).padStart(8, '0')}`, name, mimeType, parents: [parent], trashed: false, modifiedTime: new Date().toISOString() };
    files.set(f.id, f);
    return f;
  }

  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    base,
    files,
    stats,
    addFolder: (name: string, parent = 'root') => add(name, FOLDER, parent),
    addFile: (name: string, parent: string) => add(name, 'video/mp4', parent),
    children: (parent: string) => [...files.values()].filter((f) => f.parents.includes(parent) && !f.trashed),
    find: (name: string, parent?: string) =>
      [...files.values()].filter((f) => f.name === name && (!parent || f.parents.includes(parent))),
    google: (redirectUri: string) => ({
      clientId: '',
      clientSecret: '',
      redirectUri,
      authUrl: `${base}/auth`,
      tokenUrl: `${base}/token`,
      revokeUrl: `${base}/revoke`,
      apiBase: base,
    }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
