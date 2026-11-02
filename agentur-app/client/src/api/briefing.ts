// Datenabruf für Briefing, Benachrichtigungen und Engpässe.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { AppNotification, Bottleneck, Briefing, BriefingData } from '../../../shared/schemas';

export function useBriefingToday() {
  return useQuery({
    queryKey: ['briefing', 'today'],
    queryFn: () => api.get<{ briefing: Briefing | null; preview: BriefingData | null }>('/briefing/today'),
    // Vorschau regelmäßig auffrischen, falls sich Termine oder Aufgaben ändern
    refetchInterval: 5 * 60_000,
  });
}

export function useGenerateBriefing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deliver: boolean) => api.post<Briefing>('/briefing/generate', { deliver }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['briefing'] }),
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number; items: AppNotification[] }>('/notifications'),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id?: number) => api.post<{ unread: number; items: AppNotification[] }>(id ? `/notifications/${id}/read` : '/notifications/read-all'),
    onSuccess: (data) => qc.setQueryData(['notifications'], data),
  });
}

export function useBottlenecks() {
  return useQuery({ queryKey: ['projects', 'bottlenecks'], queryFn: () => api.get<Bottleneck[]>('/bottlenecks') });
}
