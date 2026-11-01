// Live-Aktualisierung: hört auf Änderungsmeldungen des Servers und lädt betroffene Daten neu.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChangeEvent } from '../../../shared/schemas';

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
        const event = JSON.parse(msg.data) as ChangeEvent;
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
