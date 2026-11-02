// Datenabruf für Kalenderansicht und Kalender-Einstellungen.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { CalendarItem, CalendarSettings, ShootCalendar } from '../../../shared/schemas';

export function useCalendarItems(range: { start: string; end: string } | null, customerId?: number) {
  const qs = range ? `start=${range.start}&end=${range.end}${customerId ? `&customer_id=${customerId}` : ''}` : '';
  return useQuery({
    queryKey: ['calendar', 'items', qs],
    queryFn: () => api.get<CalendarItem[]>(`/calendar/items?${qs}`),
    enabled: !!range,
    placeholderData: (prev) => prev,
  });
}

export function useMoveCalendarItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: string; start: string; end: string | null; all_day: boolean }) => api.post('/calendar/move', body),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useCalendarSettings(enabled = true) {
  return useQuery({
    queryKey: ['calendar', 'settings'],
    queryFn: () => api.get<CalendarSettings>('/calendar/settings'),
    enabled,
  });
}

export function useSaveCalendarSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { write_id: string; read_ids: string[]; push_approvals: boolean; push_publications: boolean }) =>
      api.put<CalendarSettings>('/calendar/settings', data),
    onSuccess: (data) => qc.setQueryData(['calendar', 'settings'], data),
  });
}

export function useSyncCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CalendarSettings>('/calendar/sync'),
    onSuccess: (data) => {
      qc.setQueryData(['calendar', 'settings'], data);
      qc.invalidateQueries({ queryKey: ['calendar', 'items'] });
    },
  });
}

export function useShootCalendar(projectId: number) {
  return useQuery({
    queryKey: ['projects', 'calendar', projectId],
    queryFn: () => api.get<ShootCalendar>(`/projects/${projectId}/calendar`),
    refetchInterval: (q) => (q.state.data?.state === 'wartet' ? 3000 : false),
  });
}

export function useRestoreShoot(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ShootCalendar>(`/projects/${projectId}/calendar/restore`),
    onSuccess: (data) => qc.setQueryData(['projects', 'calendar', projectId], data),
  });
}
