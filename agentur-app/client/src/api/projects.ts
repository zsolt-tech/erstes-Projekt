// Datenabruf für Projekte, Vorlagen und Aufgaben.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, request } from './client';
import type { ProjectDetail, ProjectListItem, ProjectTemplate, Task, TaskInput, TaskStatus } from '../../../shared/schemas';

export type ProjectScope = 'offen' | 'abgeschlossen' | 'abgebrochen' | 'alle';

export function useProjects(filter: { scope?: ProjectScope; customer_id?: number; q?: string } = {}) {
  const params = new URLSearchParams();
  if (filter.scope) params.set('scope', filter.scope);
  if (filter.customer_id) params.set('customer_id', String(filter.customer_id));
  if (filter.q?.trim()) params.set('q', filter.q.trim());
  const qs = params.toString();
  return useQuery({
    queryKey: ['projects', 'list', qs],
    queryFn: () => api.get<ProjectListItem[]>(`/projects${qs ? `?${qs}` : ''}`),
    placeholderData: (prev) => prev,
  });
}

export function useProject(id: number | undefined) {
  return useQuery({
    queryKey: ['projects', 'detail', id],
    queryFn: () => api.get<ProjectDetail>(`/projects/${id}`),
    enabled: !!id,
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<ProjectTemplate[]>('/project-templates'),
    staleTime: 5 * 60_000,
  });
}

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Führt eine Projektaktion aus und übernimmt die Antwort direkt in den Zwischenspeicher. */
export function useProjectAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ method, url, body }: { method: Method; url: string; body?: unknown }) =>
      request<ProjectDetail | undefined>(method, url, method === 'DELETE' ? undefined : (body ?? {})),
    onSuccess: (data) => {
      if (data && 'id' in data) qc.setQueryData(['projects', 'detail', data.id], data);
      qc.invalidateQueries({ queryKey: ['projects', 'list'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

// --- Aufgaben ---

export function useTasks(filter: { status?: 'offen' | 'erledigt' | 'alle'; customer_id?: number; project_id?: number } = {}) {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.customer_id) params.set('customer_id', String(filter.customer_id));
  if (filter.project_id) params.set('project_id', String(filter.project_id));
  const qs = params.toString();
  return useQuery({
    queryKey: ['tasks', qs],
    queryFn: () => api.get<Task[]>(`/tasks${qs ? `?${qs}` : ''}`),
    placeholderData: (prev) => prev,
  });
}

export function useSaveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: TaskInput }) =>
      id ? api.put<Task>(`/tasks/${id}`, data) : api.post<Task>('/tasks', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useSetTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: TaskStatus }) => api.patch<Task>(`/tasks/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
