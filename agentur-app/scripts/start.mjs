// Start mit einem Befehl: npm start
// 1. legt beim ersten Start die .env an (mit zufälligem APP_SECRET)
// 2. baut die Oberfläche, falls sie fehlt oder veraltet ist
// 3. startet den Server und öffnet den Browser
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node.js ${process.versions.node} ist zu alt. Bitte Node.js 22.13 oder neuer installieren (empfohlen: aktuelle LTS-Version von nodejs.org).`);
  process.exit(1);
}

// --- .env anlegen bzw. APP_SECRET ergänzen ---
const envFile = path.join(root, '.env');
if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(root, '.env.example'), envFile);
  console.log('[Start] .env aus .env.example angelegt');
}
let envText = fs.readFileSync(envFile, 'utf8');
if (!/^APP_SECRET=.+$/m.test(envText)) {
  const secret = crypto.randomBytes(32).toString('hex');
  envText = /^APP_SECRET=.*$/m.test(envText)
    ? envText.replace(/^APP_SECRET=.*$/m, `APP_SECRET=${secret}`)
    : `${envText.trimEnd()}\nAPP_SECRET=${secret}\n`;
  fs.writeFileSync(envFile, envText);
  console.log('[Start] APP_SECRET erzeugt');
}

const { default: dotenv } = await import('dotenv');
dotenv.config({ path: envFile, quiet: true });
const port = Number(process.env.PORT) || 3000;
const url = `http://localhost:${port}`;
const noOpen = process.argv.includes('--no-open') || process.env.OPEN_BROWSER === 'false';

async function openBrowser() {
  if (noOpen) return;
  try {
    const { default: open } = await import('open');
    await open(url);
  } catch {
    console.log(`[Start] Bitte im Browser öffnen: ${url}`);
  }
}

// --- Läuft die App schon? Dann nur den Browser öffnen ---
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
  const body = await res.json().catch(() => ({}));
  if (body.app === 'agentur-verwaltung') {
    console.log(`[Start] Die App läuft bereits unter ${url}`);
    await openBrowser();
    process.exit(0);
  }
} catch {
  /* läuft noch nicht */
}

// --- Oberfläche bauen, falls nötig ---
function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return newest;
}
const builtIndex = path.join(root, 'dist', 'client', 'index.html');
const sourcesNewest = Math.max(
  newestMtime(path.join(root, 'client')),
  newestMtime(path.join(root, 'shared')),
  fs.statSync(path.join(root, 'vite.config.ts')).mtimeMs,
);
if (!fs.existsSync(builtIndex) || fs.statSync(builtIndex).mtimeMs < sourcesNewest) {
  console.log('[Start] Oberfläche wird gebaut (beim ersten Mal ca. 10 bis 30 Sekunden) ...');
  const { build } = await import('vite');
  await build({ configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn' });
  console.log('[Start] Oberfläche gebaut');
}

// --- Server starten ---
const { register } = await import('tsx/esm/api');
register();
await import('../server/index.ts');
await openBrowser();
