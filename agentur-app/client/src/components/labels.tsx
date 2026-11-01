// Darstellung von Status und Kategorien.
import { Badge, type Tone } from './ui';
import {
  CUSTOMER_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  PHASE_LABELS,
  PIPELINE_STAGE_LABELS,
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  type CustomerStatus,
  type InvoiceStatus,
  type Phase,
  type PipelineStage,
  type Priority,
  type ProjectStatus,
} from '../../../shared/schemas';

const STATUS_TONE: Record<CustomerStatus, Tone> = {
  interessent: 'violet',
  aktiv: 'success',
  pausiert: 'warning',
  beendet: 'neutral',
};

export function CustomerStatusBadge({ status, stage }: { status: CustomerStatus; stage?: PipelineStage | null }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      {CUSTOMER_STATUS_LABELS[status]}
      {status === 'interessent' && stage ? ` · ${PIPELINE_STAGE_LABELS[stage]}` : ''}
    </Badge>
  );
}


export function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <Badge tone="accent">
      {phase} · {PHASE_LABELS[phase]}
    </Badge>
  );
}

const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  aktiv: 'success',
  pausiert: 'warning',
  abgeschlossen: 'neutral',
  abgebrochen: 'danger',
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={PROJECT_STATUS_TONE[status]}>{PROJECT_STATUS_LABELS[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === 'normal') return null;
  return <Badge tone={priority === 'hoch' ? 'danger' : 'neutral'}>Priorität {PRIORITY_LABELS[priority].toLowerCase()}</Badge>;
}

const INVOICE_TONE: Record<InvoiceStatus, Tone> = { offen: 'neutral', gestellt: 'warning', bezahlt: 'success' };

export function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={INVOICE_TONE[status]}>Rechnung {INVOICE_STATUS_LABELS[status].toLowerCase()}</Badge>;
}
