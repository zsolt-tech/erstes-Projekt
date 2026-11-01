// Platzhalter für Bereiche, die in späteren Etappen folgen.
import { Link } from 'react-router-dom';
import { Card, EmptyState, PageHeader } from '../components/ui';

export function PlaceholderPage({ title, stage, text }: { title: string; stage: number; text: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState title={`Folgt in Etappe ${stage}`} text={text} />
      </Card>
    </>
  );
}

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        title="Seite nicht gefunden"
        text={
          <Link to="/" className="text-accent hover:underline">
            Zur Startseite
          </Link>
        }
      />
    </Card>
  );
}
