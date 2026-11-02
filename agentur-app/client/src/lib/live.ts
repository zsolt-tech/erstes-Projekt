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

export function useLiveUpdates(): boolean {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => {
      setConnected(true);
      // Nach einer Unterbrechung alles auffrischen
      qc.invalidateQueries();
    };
    source.onerror = () => setConnected(false);
    source.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as LiveEvent;
        if (event.type === 'notify') {
          showBrowserNotification(event.title, event.body, event.link);
          return;
        }
        if (event.type !== 'changed') return;
        qc.invalidateQueries({ queryKey: [event.entity] });
        // Warteschlange betrifft den Drive-Stand von Kunden und Projekten
        if (event.entity === 'sync' || event.entity === 'google') {
          qc.invalidateQueries({ queryKey: ['customers', 'drive'] });
          qc.invalidateQueries({ queryKey: ['projects', 'drive'] });
        }
      } catch {
        /* ungültige Nachricht ignorieren */
      }
    };
    return () => source.close();
  }, [qc]);
  return connected;
}
