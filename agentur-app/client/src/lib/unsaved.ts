// Ungespeicherte Änderungen: Rückfrage beim Schließen des Fensters und beim Wechsel auf eine andere Seite der App.
import { useEffect } from 'react';

let open = 0;

export function hasUnsavedChanges(): boolean {
  return open > 0;
}

/** In Formularen aufrufen; solange dirty, fragt die App vor dem Verlassen nach */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    open++;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => {
      open--;
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);
}
