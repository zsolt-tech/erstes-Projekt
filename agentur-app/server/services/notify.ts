// Benachrichtigungen: Benachrichtigungszentrale in der App, Hinweis an offene Browserfenster
// und native Desktop-Benachrichtigung des Betriebssystems (ohne Zusatzpakete).
import { execFile } from 'node:child_process';
import type { Database } from '../db/database.ts';
import { events } from '../lib/events.ts';
import type { AppNotification, NotificationType } from '../../shared/schemas.ts';

/** Native Desktop-Benachrichtigung. Fehler werden nur protokolliert. */
export function desktopNotification(title: string, body: string): void {
  if (process.env.AGENTUR_NO_DESKTOP === '1') return;
  const text = body.length > 220 ? `${body.slice(0, 217)}...` : body;
  const done = (err: Error | null) => {
    if (err) console.error('[Benachrichtigung] Desktop-Hinweis nicht möglich:', err.message);
  };
  if (process.platform === 'darwin') {
    // AppleScript-Zeichenketten: Backslash und Anführungszeichen maskieren
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execFile('osascript', ['-e', `display notification "${esc(text)}" with title "${esc(title)}" sound name "Glass"`], done);
  } else if (process.platform === 'win32') {
    // Windows 10/11: Toast über die Windows-Runtime, ohne Zusatzmodule
    const esc = (s: string) => s.replace(/'/g, "''");
    const script = [
      '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
      '$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
      `$t.GetElementsByTagName('text')[0].AppendChild($t.CreateTextNode('${esc(title)}')) > $null`,
      `$t.GetElementsByTagName('text')[1].AppendChild($t.CreateTextNode('${esc(text)}')) > $null`,
      '$n = [Windows.UI.Notifications.ToastNotification]::new($t)',
      "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($n)",
    ].join('; ');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, done);
  } else {
    execFile('notify-send', [title, text], done);
  }
}

export interface NotifyOptions {
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  dedupeKey?: string;
  desktop?: boolean;
}

/**
 * Legt eine Benachrichtigung an (einmalig je dedupeKey), meldet sie an offene Browserfenster
 * und zeigt auf Wunsch einen Desktop-Hinweis. Gibt false zurück, wenn es sie schon gab.
 */
export function notify(db: Database, opts: NotifyOptions): boolean {
  const r = db.run(
    `INSERT INTO notifications (type, title, body, link, dedupe_key) VALUES (:type, :title, :body, :link, :key)
     ON CONFLICT(dedupe_key) DO NOTHING`,
    { type: opts.type, title: opts.title, body: opts.body, link: opts.link ?? null, key: opts.dedupeKey ?? null },
  );
  if (r.changes === 0) return false;
  events.changed('notifications');
  events.notify(opts.title, opts.body, opts.link ?? null);
  if (opts.desktop) desktopNotification(opts.title, opts.body);
  return true;
}

export function listNotifications(db: Database): { unread: number; items: AppNotification[] } {
  return {
    unread: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL')!.n,
    items: db.all<AppNotification>(
      'SELECT id, type, title, body, link, created_at, read_at FROM notifications ORDER BY created_at DESC, id DESC LIMIT 50',
    ),
  };
}

export function markRead(db: Database, id?: number): void {
  const now = new Date().toISOString();
  if (id) db.run('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?', [now, id]);
  else db.run('UPDATE notifications SET read_at = ? WHERE read_at IS NULL', [now]);
  // Ältere gelesene Benachrichtigungen aufräumen
  db.run("DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?", [new Date(Date.now() - 60 * 86400000).toISOString()]);
  events.changed('notifications');
}
