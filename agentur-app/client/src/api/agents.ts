// Datenabruf für die Claude-Agenten und die Qualitätsprüfung.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { AgentKind, QualityCheck, QualityCheckInput } from '../../../shared/schemas';

export function useQualityChecks(projectId: number) {
  return useQuery({
    queryKey: ['projects', 'quality', projectId],
    queryFn: () => api.get<QualityCheck[]>(`/projects/${projectId}/quality-checks`),
  });
}

export function useAddQualityCheck(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: QualityCheckInput) => api.post<QualityCheck[]>(`/projects/${projectId}/quality-checks`, data),
    onSuccess: (data) => {
      qc.setQueryData(['projects', 'quality', projectId], data);
      qc.invalidateQueries({ queryKey: ['projects', 'detail', projectId] });
    },
  });
}

export function useDeleteQualityCheck(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<QualityCheck[]>(`/quality-checks/${id}`),
    onSuccess: (data) => {
      qc.setQueryData(['projects', 'quality', projectId], data);
      qc.invalidateQueries({ queryKey: ['projects', 'detail', projectId] });
    },
  });
}

export function fetchAgentPrompt(projectId: number, kind: AgentKind, dauer?: number) {
  return api.get<{ prompt: string }>(`/projects/${projectId}/agent-prompt?kind=${kind}${dauer ? `&dauer=${dauer}` : ''}`);
}
