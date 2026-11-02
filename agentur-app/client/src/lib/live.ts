// Live-Aktualisierung: hört auf Änderungsmeldungen des Servers und lädt betroffene Daten neu.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LiveEvent } from '../../../shared/schemas';

/** Browser-Benachrichtigungen sind eine Einstellung je Rechner */
export function browserNotifyEnabled(): boolean {
  try {
    return localStorage.getItem('browser-notify') === '1' && 'Notification' in window && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

function showBrowserNotification(title: string, body: string, link: string | null) {
  if (!browserNotifyEnabled()) return;
  const n = new Notification(title, { body, tag: title });
  n.onclick = () => {
    window.focus();
    if (link && window.location.pathname !== link) window.location.assign(link);
    n.close();
  };
}

const BRIEFING_SOURCES = new Set(['projects', 'tasks', 'customers', 'calendar', 'settings']);

/**
 * Live-Aktualisierung über eine einzige Serververbindung für alle Tabs: Browser erlauben nur wenige
 * gleichzeitige Verbindungen je Adresse (6 bei Chrome), mehrere Tabs mit eigener Verbindung würden die
 * App sonst blockieren. Ein Tab hält die Verbindung (Web Locks) und gibt Meldungen per BroadcastChannel weiter.
 */
export function useLiveUpdates(): boolean {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('agentur-live') : null;
    const abort = new AbortController();
    let source: EventSource | null = null;
    let release: (() => void) | null = null;

    const apply = (raw: string, leader: boolean) => {
      try {
        const event = JSON.parse(raw) as LiveEvent;
        if (event.type === 'notify') {
          // Browser-Benachrichtigung nur einmal, vom verbindenden Tab
          if (leader) showBrowserNotification(event.title, event.body, event.link);
          return;
        }
        if (event.type !== 'changed') return;
        qc.invalidateQueries({ queryKey: [event.entity] });
        // Das Briefing auf der Startseite zeigt immer den aktuellen Stand
        if (BRIEFING_SOURCES.has(event.entity)) qc.invalidateQueries({ queryKey: ['briefing'] });
        // Warteschlange betrifft den Drive-Stand von Kunden und Projekten
        if (event.entity === 'sync' || event.entity === 'google') {
          qc.invalidateQueries({ queryKey: ['customers', 'drive'] });
          qc.invalidateQueries({ queryKey: ['projects', 'drive'] });
        }
      } catch {
        /* ungültige Nachricht ignorieren */
      }
    };

    const connect = () => {
      source = new EventSource('/api/events');
      source.onopen = () => {
        setConnected(true);
        // Nach einer Unterbrechung alles auffrischen
        qc.invalidateQueries();
        channel?.postMessage({ kind: 'status', ok: true });
      };
      source.onerror = () => {
        setConnected(false);
        channel?.postMessage({ kind: 'status', ok: false });
      };
      source.onmessage = (msg) => {
        apply(msg.data, true);
        channel?.postMessage({ kind: 'event', data: msg.data });
      };
    };

    if (channel) {
      channel.onmessage = (e: MessageEvent<{ kind: 'event'; data: string } | { kind: 'status'; ok: boolean }>) => {
        if (e.data.kind === 'event') apply(e.data.data, false);
        else {
          setConnected(e.data.ok);
          if (e.data.ok) qc.invalidateQueries();
        }
      };
    }

    if (channel && navigator.locks) {
      navigator.locks
        .request('agentur-live', { signal: abort.signal }, () => {
          connect();
          return new Promise<void>((resolve) => (release = resolve));
        })
        .catch(() => undefined);
    } else {
      connect();
    }

    return () => {
      abort.abort();
      source?.close();
      release?.();
      channel?.close();
    };
  }, [qc]);
  return connected;
}
