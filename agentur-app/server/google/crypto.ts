// Verschlüsselung der Google-Tokens mit dem APP_SECRET aus der .env (AES-256-GCM).
import crypto from 'node:crypto';

function key(secret: string): Buffer {
  if (!secret) throw new Error('APP_SECRET fehlt in der .env. Bitte die App mit "npm start" starten, dann wird er erzeugt.');
  return crypto.createHash('sha256').update(secret).digest();
}

export function encrypt(plain: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(secret), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function decrypt(token: string, secret: string): string {
  const [version, iv, tag, data] = token.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unbekanntes Format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
