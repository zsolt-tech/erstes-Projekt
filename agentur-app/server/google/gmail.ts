// E-Mail-Versand über das verbundene Google-Konto (Gmail API, nur Senden).
import type { GoogleClient } from './client.ts';
import type { SyncQueue } from './queue.ts';

/**
 * Kodiert einen Kopfzeilenwert nach RFC 2047, damit Umlaute korrekt ankommen. Lange Werte werden in
 * mehrere kodierte Wörter (je höchstens 75 Zeichen) aufgeteilt, ohne ein Zeichen zu trennen.
 */
export function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = [];
  let chunk = '';
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/** Baut eine MIME-Nachricht mit Text- und HTML-Teil */
export function buildMime(to: string, subject: string, text: string, html: string): string {
  const boundary = `agentur-${Date.now().toString(36)}`;
  const b64 = (s: string) =>
    Buffer.from(s, 'utf8')
      .toString('base64')
      .replace(/.{76}/g, '$&\r\n');
  return [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export class GmailService {
  constructor(
    private google: GoogleClient,
    private queue: SyncQueue,
  ) {
    queue.register('gmail.send', async (p) => {
      await this.sendNow(String(p.to), String(p.subject), String(p.text), String(p.html));
    });
  }

  /** Versand über die Warteschlange: ohne Internet wird später nachgeholt */
  send(to: string, subject: string, text: string, html: string) {
    this.queue.enqueue('gmail.send', { to, subject, text, html, label: `E-Mail „${subject}“ an ${to}` });
  }

  async sendNow(to: string, subject: string, text: string, html: string): Promise<void> {
    const raw = Buffer.from(buildMime(to, subject, text, html), 'utf8').toString('base64url');
    await this.google.request('POST', '/gmail/v1/users/me/messages/send', { body: { raw } });
  }
}
