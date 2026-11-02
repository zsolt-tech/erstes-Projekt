// E-Mail-Versand über das verbundene Google-Konto (Gmail API, nur Senden).
import type { GoogleClient } from './client.ts';
import type { SyncQueue } from './queue.ts';

/** Kodiert einen Kopfzeilenwert nach RFC 2047, damit Umlaute korrekt ankommen */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
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
