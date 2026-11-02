// Videoschnitt mit Claude: vorbereiteter Auftrag und gemeldete Ergebnisse der Endkontrolle.
import { useState } from 'react';
import { Bot, ClipboardCopy, Film, ScanSearch, Trash2 } from 'lucide-react';
import { fetchAgentPrompt, useDeleteQualityCheck, useQualityChecks } from '../api/agents';
import { useCustomer } from '../api/hooks';
import { Dialog, useConfirm, useToast } from './feedback';
import { Badge, Button, IconButton, Input, Textarea } from './ui';
import { formatDateTime } from '../lib/format';
import { QA_PROFILE_BY_TYPE, QA_PROFILE_LABELS, type AgentKind, type ProjectDetail, type QualityCheck } from '../../../shared/schemas';

const VERDICT: Record<QualityCheck['verdict'], { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  freigegeben: { label: 'bestanden', tone: 'success' },
  zurueck: { label: 'zurück', tone: 'warning' },
  offen: { label: 'offen', tone: 'neutral' },
};

const TITLES: Record<AgentKind, string> = {
  videoschnitt: 'Auftrag: Schnitt und Endkontrolle',
  endkontrolle: 'Auftrag: nur Endkontrolle',
  highlight: 'Auftrag: Highlight-Reel',
  pdf: 'Auftrag: PDF',
};

export function AgentPanel({ project }: { project: ProjectDetail }) {
  const { data: checks = [] } = useQualityChecks(project.id);
  const { data: customer } = useCustomer(project.customer_id);
  const remove = useDeleteQualityCheck(project.id);
  const toast = useToast();
  const confirm = useConfirm();
  const [prompt, setPrompt] = useState<{ kind: AgentKind; text: string } | null>(null);
  const [loading, setLoading] = useState<AgentKind | null>(null);
  const [dauer, setDauer] = useState('30');

  const profile = customer ? (customer.qa_profile ?? QA_PROFILE_BY_TYPE[customer.customer_type]) : null;

  async function open(kind: AgentKind) {
    setLoading(kind);
    try {
      const r = await fetchAgentPrompt(project.id, kind, kind === 'highlight' ? Number(dauer) : undefined);
      setPrompt({ kind, text: r.prompt });
    } catch (err) {
      toast.error(err);
    } finally {
      setLoading(null);
    }
  }

  async function copy() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt.text);
      toast.success('Auftrag kopiert. Jetzt in Claude einfügen.');
    } catch {
      toast.error('Kopieren nicht möglich. Bitte den Text markieren und mit Cmd+C kopieren.');
    }
  }

  const finals = checks.filter((c) => c.stage === 'endkontrolle');
  return (
    <div className="rounded-md border border-line p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-fg">
          <Bot className="size-4 text-accent" />
          Videoschnitt mit Claude
        </h3>
        {profile && (
          <span className="text-xs text-muted">
            Prüfprofil {QA_PROFILE_LABELS[profile]}
            {customer?.qa_motion_required ? ', Bewegung Pflicht' : ''}
            {customer?.qa_profile ? '' : ' (aus Kundentyp)'}
          </span>
        )}
      </div>
      <p className="mb-3 text-sm text-muted">
        Der Agent „videoschnitt“ arbeitet mit deinem Skill Clip-Qualitätsprüfung. Er holt sich Projekt, Kunde, Drive-Ordner und Kundenfeedback aus der App und
        meldet das Ergebnis der Endkontrolle zurück. Sind alle Videos bestanden, wird „Clip-Qualitätsprüfung abgeschlossen“ automatisch abgehakt.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="primary" icon={<Film className="size-4" />} loading={loading === 'videoschnitt'} onClick={() => open('videoschnitt')}>
          Schnitt und Endkontrolle
        </Button>
        <Button icon={<ScanSearch className="size-4" />} loading={loading === 'endkontrolle'} onClick={() => open('endkontrolle')}>
          Nur Endkontrolle
        </Button>
        <div className="flex items-end gap-1.5">
          <Button loading={loading === 'highlight'} onClick={() => open('highlight')}>
            Highlight-Reel
          </Button>
          <Input type="number" min={5} max={600} value={dauer} onChange={(e) => setDauer(e.target.value)} className="h-9 w-20" aria-label="Länge in Sekunden" />
          <span className="pb-2 text-xs text-muted">Sek.</span>
        </div>
      </div>

      <div className="mt-4">
        <h4 className="mb-1 text-[13px] font-semibold text-fg">Endkontrolle</h4>
        {finals.length === 0 ? (
          <p className="text-sm text-subtle">Noch kein Ergebnis gemeldet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {finals.map((c) => (
              <li key={c.id} className="group py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={VERDICT[c.verdict].tone}>{VERDICT[c.verdict].label}</Badge>
                  <span className="font-medium text-fg">{c.video_name}</span>
                  <span className="text-xs text-muted">
                    Durchlauf {c.run_no} · {formatDateTime(c.created_at)}
                    {c.source === 'manuell' ? ' · von Hand' : ''}
                  </span>
                  <IconButton label="Ergebnis entfernen" className="ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={async () => {
                      if (!(await confirm({ title: 'Prüfergebnis entfernen?', text: `Das Ergebnis für „${c.video_name}“ wird gelöscht und der Qualitäts-Haken neu berechnet.`, confirmLabel: 'Entfernen', danger: true }))) return;
                      remove.mutate(c.id, { onError: (err) => toast.error(err) });
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
                {c.summary && <p className="mt-0.5 text-muted">{c.summary}</p>}
                {c.issues.length > 0 && (
                  <ul className="mt-1 grid gap-0.5 text-xs">
                    {c.issues.map((i, n) => (
                      <li key={n} className="text-warning">
                        {i.t && <span className="mr-1.5 font-medium tabular">{i.t}</span>}
                        {i.text}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={!!prompt}
        onClose={() => setPrompt(null)}
        title={prompt ? TITLES[prompt.kind] : ''}
        wide
        footer={
          <>
            <Button onClick={() => setPrompt(null)}>Schließen</Button>
            <Button variant="primary" icon={<ClipboardCopy className="size-4" />} onClick={copy}>
              Kopieren
            </Button>
          </>
        }
      >
        <ol className="mb-3 grid list-decimal gap-1 pl-5 text-sm text-muted">
          <li>Auftrag kopieren.</li>
          <li>Claude Desktop öffnen, Bereich „Code“, Ordner „agentur-app“ wählen.</li>
          <li>Einfügen und senden. Die App muss dabei laufen.</li>
        </ol>
        <Textarea value={prompt?.text ?? ''} readOnly rows={12} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Auftrag" />
      </Dialog>
    </div>
  );
}
