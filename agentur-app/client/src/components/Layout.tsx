// Rahmen der App: Seitenleiste mit Navigation, Inhaltsbereich.
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Building2,
  CalendarDays,
  Clapperboard,
  FileChartColumn,
  Gauge,
  House,
  ListChecks,
  Menu,
  Monitor,
  Moon,
  Settings,
  Sun,
  Target,
  Timer,
  X,
} from 'lucide-react';
import { useSettings } from '../api/hooks';
import { useLiveUpdates } from '../lib/live';
import { NotificationBell } from './Notifications';
import { ErrorBoundary } from './ErrorBoundary';
import { useConfirm } from './feedback';
import { hasUnsavedChanges } from '../lib/unsaved';
import { useTheme } from '../lib/theme';
import { cx } from './ui';
import type { Theme } from '../../../shared/schemas';

const NAV = [
  { to: '/', label: 'Start', icon: House, end: true },
  { to: '/dashboard', label: 'Dashboard', icon: Gauge },
  { to: '/kunden', label: 'Kunden', icon: Building2 },
  { to: '/akquise', label: 'Akquise', icon: Target },
  { to: '/projekte', label: 'Projekte', icon: Clapperboard },
  { to: '/aufgaben', label: 'Aufgaben', icon: ListChecks },
  { to: '/kalender', label: 'Kalender', icon: CalendarDays },
  { to: '/zeiten', label: 'Zeiterfassung', icon: Timer },
  { to: '/berichte', label: 'Berichte', icon: FileChartColumn },
];

const THEME_NEXT: Record<Theme, Theme> = { system: 'hell', hell: 'dunkel', dunkel: 'system' };
const THEME_LABEL: Record<Theme, string> = { system: 'Wie System', hell: 'Hell', dunkel: 'Dunkel' };

function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  const Icon = theme === 'hell' ? Sun : theme === 'dunkel' ? Moon : Monitor;
  return (
    <button
      type="button"
      onClick={() => setTheme(THEME_NEXT[theme])}
      title="Darstellung wechseln"
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-sidebar-fg hover:bg-sidebar-active hover:text-white"
    >
      <Icon className="size-4" />
      Darstellung: {THEME_LABEL[theme]}
    </button>
  );
}

function NavItem({ to, label, icon: Icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
          isActive ? 'bg-sidebar-active text-white' : 'text-sidebar-fg hover:bg-sidebar-active hover:text-white',
        )
      }
    >
      <Icon className="size-4" />
      {label}
    </NavLink>
  );
}

export function Layout() {
  const { data: settings } = useSettings();
  const connected = useLiveUpdates();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const confirm = useConfirm();

  // Ungespeicherte Formulare: vor dem Wechsel auf eine andere Seite der App nachfragen
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!hasUnsavedChanges() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || !a.href || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      e.preventDefault();
      e.stopPropagation();
      void confirm({
        title: 'Änderungen verwerfen?',
        text: 'Im Formular gibt es ungespeicherte Änderungen. Wenn du die Seite wechselst, gehen sie verloren.',
        confirmLabel: 'Verwerfen und wechseln',
        danger: true,
      }).then((ok) => ok && navigate(url.pathname + url.search + url.hash));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [confirm, navigate]);
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar px-3 py-4">
      <div className="mb-6 flex items-center gap-2.5 px-2.5">
        <div className="flex size-7 items-center justify-center rounded-md bg-accent">
          <svg viewBox="0 0 32 32" className="size-4" aria-hidden="true">
            <path d="M10 7.5v17l14-8.5z" fill="white" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{settings?.agency_name || 'Agentur'}</div>
          <div className="text-[11px] text-sidebar-fg/70">Verwaltung</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5" aria-label="Hauptnavigation">
        {NAV.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>
      <div className="mt-4 flex flex-col gap-0.5 border-t border-white/10 pt-4">
        <NotificationBell />
        <NavItem to="/einstellungen" label="Einstellungen" icon={Settings} />
        <ThemeSwitch />
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 lg:block">{sidebar}</aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-60">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center gap-2 border-b border-line bg-surface px-4 lg:hidden">
          <button
            type="button"
            aria-label={menuOpen ? 'Menü schließen' : 'Menü öffnen'}
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2"
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="text-sm font-semibold">{settings?.agency_name || 'Agentur'}</span>
        </div>
        {!connected && (
          <div className="border-b border-warning/30 bg-warning-soft px-4 py-2 text-[13px] text-warning">
            Keine Verbindung zum Server. Die Anzeige wird aktualisiert, sobald die App wieder erreichbar ist.
          </div>
        )}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
            <ErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
