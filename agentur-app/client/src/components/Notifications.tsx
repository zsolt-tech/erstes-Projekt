// Glocke mit Benachrichtigungen in der Seitenleiste.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, CloudAlert, Newspaper, TriangleAlert } from 'lucide-react';
import { useMarkRead, useNotifications } from '../api/briefing';
import { cx } from './ui';
import { formatDateTime } from '../lib/format';
import type { NotificationType } from '../../../shared/schemas';

const ICONS: Record<NotificationType, typeof Bell> = {
  briefing: Newspaper,
  freigabe_erinnerung: CalendarClock,
  engpass: TriangleAlert,
  sync_fehler: CloudAlert,
  backup: CloudAlert,
  system: Bell,
};

export function NotificationBell() {
  const { data } = useNotifications();
  const mark = useMarkRead();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const unread = data?.unread ?? 0;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-sidebar-fg hover:bg-sidebar-active hover:text-white"
      >
        <Bell className="size-4" />
        Benachrichtigungen
        {unread > 0 && (
          <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg tabular">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface text-fg shadow-xl lg:bottom-0 lg:left-full lg:mb-0 lg:ml-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold">Benachrichtigungen</span>
            {unread > 0 && (
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => mark.mutate(undefined)}>
                Alle gelesen
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {!data?.items.length && <li className="px-4 py-6 text-center text-sm text-muted">Keine Benachrichtigungen</li>}
            {data?.items.map((n) => {
              const Icon = ICONS[n.type] ?? Bell;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.read_at) mark.mutate(n.id);
                      setOpen(false);
                      if (n.link) navigate(n.link);
                    }}
                    className={cx('flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2', !n.read_at && 'bg-accent-soft/40')}
                  >
                    <Icon className={cx('mt-0.5 size-4 shrink-0', n.type === 'freigabe_erinnerung' || n.type === 'engpass' ? 'text-warning' : n.type === 'sync_fehler' ? 'text-danger' : 'text-accent')} />
                    <span className="min-w-0 flex-1">
                      <span className={cx('block text-[13px]', !n.read_at ? 'font-semibold' : 'font-medium')}>{n.title}</span>
                      {n.body && <span className="mt-0.5 line-clamp-3 block text-xs text-muted">{n.body}</span>}
                      <span className="mt-1 block text-[11px] text-subtle">{formatDateTime(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
