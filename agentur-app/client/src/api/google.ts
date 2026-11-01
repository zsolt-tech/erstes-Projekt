// Datenabruf für Google-Verbindung, Drive-Ordner und Warteschlange.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { CustomerDrive, GoogleStatus, ProjectDrive, SyncJob } from '../../../shared/schemas';

export function useGoogleStatus() {
  return useQuery({ queryKey: ['google', 'status'], queryFn: () => api.get<GoogleStatus>('/google/status') });
}

export function useSaveCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (json: string) =>
      api.post<{ client_id: string; redirect_uri_ok: boolean; status: GoogleStatus }>('/google/credentials', { json }),
    onSuccess: (data) => qc.setQueryData(['google', 'status'], data.status),
  });
}

export function useDisconnectGoogle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<GoogleStatus>('/google/disconnect'),
    onSuccess: (data) => {
      qc.setQueryData(['google', 'status'], data);
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useSyncJobs() {
  return useQuery({ queryKey: ['sync', 'jobs'], queryFn: () => api.get<SyncJob[]>('/sync/jobs') });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<SyncJob[]>(`/sync/jobs/${id}/retry`),
    onSuccess: (data) => qc.setQueryData(['sync', 'jobs'], data),
  });
}

// Solange Ordner angelegt werden, zusätzlich nachfragen: Live-Meldungen können beim Laden der Seite verpasst werden
const pollWhileWaiting = (q: { state: { data?: { state: string } } }) => (q.state.data?.state === 'wartet' ? 2000 : false);

export function useCustomerDrive(id: number) {
  return useQuery({
    queryKey: ['customers', 'drive', id],
    queryFn: () => api.get<CustomerDrive>(`/customers/${id}/drive`),
    refetchInterval: pollWhileWaiting,
  });
}

export function useProjectDrive(id: number) {
  return useQuery({
    queryKey: ['projects', 'drive', id],
    queryFn: () => api.get<ProjectDrive>(`/projects/${id}/drive`),
    refetchInterval: pollWhileWaiting,
  });
}

/** Drive-Aktion für Kunde oder Projekt; die Antwort ersetzt den angezeigten Stand */
export function useDriveAction(kind: 'customers' | 'projects', id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ method, path, body }: { method: 'POST' | 'DELETE'; path: string; body?: unknown }) =>
      method === 'DELETE' ? api.del<CustomerDrive | ProjectDrive>(`/${kind}/${id}/drive${path}`) : api.post<CustomerDrive | ProjectDrive>(`/${kind}/${id}/drive${path}`, body),
    onSuccess: (data) => {
      qc.setQueryData([kind, 'drive', id], data);
      qc.invalidateQueries({ queryKey: [kind, 'detail', id] });
      qc.invalidateQueries({ queryKey: ['sync'] });
    },
  });
}
