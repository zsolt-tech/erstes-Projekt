// Fängt Fehler beim Anzeigen einer Seite ab, damit nicht die ganze App weiß bleibt.
import { Component, type ReactNode } from 'react';
import { Button } from './ui';

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[Oberfläche]', error);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // Beim Wechsel auf eine andere Seite neu versuchen
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-line bg-surface p-6 text-sm">
        <h1 className="mb-2 text-base font-semibold text-fg">Diese Seite konnte nicht angezeigt werden</h1>
        <p className="mb-4 text-muted">
          Es ist ein unerwarteter Fehler aufgetreten. Deine Daten sind gespeichert. Bitte die Seite neu laden; tritt der Fehler wieder auf, hilft
          die Meldung unten bei der Fehlersuche.
        </p>
        <pre className="mb-4 overflow-x-auto rounded-md bg-surface-2 p-3 text-xs text-muted">{this.state.error.message}</pre>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Neu laden
          </Button>
          <Button onClick={() => window.location.assign('/')}>Zur Startseite</Button>
        </div>
      </div>
    );
  }
}
