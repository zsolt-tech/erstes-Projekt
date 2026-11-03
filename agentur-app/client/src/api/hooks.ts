// Datenabruf mit TanStack Query. Schlüssel beginnen mit dem Bereich, damit Live-Ereignisse
// gezielt alle betroffenen Abfragen neu laden können.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  BackupInfo,
  BackupOverview,
  Customer,
  CustomerInput,
  CustomerListItem,
  CustomerStatus,
  DeliverableType,
  Settings,
  TeamMember,
} from '../../../shared/schemas';

// --- Kunden ---

export interface CustomerFilter {
  status?: CustomerStatus | '';
  q?: string;
  archived?: boolean;
}

export function useCustomers(filter: CustomerFilter) {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.q?.trim()) params.set('q', filter.q.trim());
  if (filter.archived) params.set('archived', '1');
  const qs = params.toString();
  return useQuery({
    queryKey: ['customers', 'list', qs],
    queryFn: () => api.get<CustomerListItem[]>(`/customers${qs ? `?${qs}` : ''}`),
    placeholderData: (prev) => prev,
  });
}

export function useCustomer(id: number | undefined, month?: string) {
  return useQuery({
    queryKey: ['customers', 'detail', id, month],
    queryFn: () => api.get<Customer>(`/customers/${id}${month ? `?month=${month}` : ''}`),
    enabled: !!id,
    placeholderData: (prev) => prev,
  });
}

export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data, expectedUpdatedAt }: { id?: number; data: CustomerInput; expectedUpdatedAt?: string }) =>
      id ? api.put<Customer>(`/customers/${id}`, { ...data, expected_updated_at: expectedUpdatedAt }) : api.post<Customer>('/customers', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
}

export function useArchiveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      api.post<Customer>(`/customers/${id}/${archived ? 'archive' : 'unarchive'}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
}

// --- Einstellungen und Stammdaten ---

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings'), staleTime: 60_000 });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.put<Settings>('/settings', patch),
    onSuccess: (data) => qc.setQueryData(['settings'], data),
  });
}

export function useDeliverableTypes() {
  return useQuery({
    queryKey: ['deliverable-types'],
    queryFn: () => api.get<DeliverableType[]>('/deliverable-types'),
    staleTime: 60_000,
  });
}

export function useSaveDeliverableType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id?: number; name: string; active?: boolean; sort_order?: number }) =>
      id ? api.put<DeliverableType>(`/deliverable-types/${id}`, data) : api.post<DeliverableType>('/deliverable-types', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deliverable-types'] }),
  });
}

export function useTeam() {
  return useQuery({ queryKey: ['team'], queryFn: () => api.get<TeamMember[]>('/team'), staleTime: 60_000 });
}

export function useSaveTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id?: number;
      name: string;
      email: string | null;
      color?: string;
      weekly_capacity_h: number | null;
      active?: boolean;
    }) => (id ? api.put<TeamMember>(`/team/${id}`, data) : api.post<TeamMember>('/team', data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });
}

// --- Datensicherung ---

export function useBackups() {
  return useQuery({ queryKey: ['backups'], queryFn: () => api.get<BackupOverview>('/backups') });
}

export function useRunBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BackupInfo>('/backups'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });
}
