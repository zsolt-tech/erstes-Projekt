// Hell-/Dunkelmodus. Die Wahl gilt pro Rechner und wird im Browser gespeichert.
import { useEffect, useState } from 'react';
import type { Theme } from '../../../shared/schemas';

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    if (t === 'hell' || t === 'dunkel' || t === 'system') return t;
  } catch {
    /* Speicher nicht verfügbar */
  }
  return 'system';
}

function apply(theme: Theme) {
  const dark =
    theme === 'dunkel' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

const listeners = new Set<(t: Theme) => void>();

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* Speicher nicht verfügbar */
  }
  apply(theme);
  listeners.forEach((l) => l(theme));
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setState] = useState<Theme>(readTheme);
  useEffect(() => {
    listeners.add(setState);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply(readTheme());
    mq.addEventListener('change', onChange);
    return () => {
      listeners.delete(setState);
      mq.removeEventListener('change', onChange);
    };
  }, []);
  return [theme, setTheme];
}
