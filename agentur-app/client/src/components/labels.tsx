// Darstellung von Status und Kategorien.
import { Badge, type Tone } from './ui';
import {
  CUSTOMER_STATUS_LABELS,
  PIPELINE_STAGE_LABELS,
  type CustomerStatus,
  type PipelineStage,
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
