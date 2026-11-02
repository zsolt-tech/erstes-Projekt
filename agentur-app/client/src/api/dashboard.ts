// Datenabruf für das Live-Dashboard.
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { DashboardData } from '../../../shared/schemas';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
    // Änderungen kommen über die Live-Verbindung; zusätzlich jede Minute für Uhrzeit und Tageswechsel
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
