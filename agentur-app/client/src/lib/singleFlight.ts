// Schutz vor Doppelklicks: eine Aktion läuft nur einmal gleichzeitig.
import { useRef } from 'react';

export function useSingleFlight() {
  const busy = useRef(false);
  return async function once<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (busy.current) return undefined;
    busy.current = true;
    try {
      return await fn();
    } finally {
      busy.current = false;
    }
  };
}
