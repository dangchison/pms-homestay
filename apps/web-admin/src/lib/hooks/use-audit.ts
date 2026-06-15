import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AuditLogResponse, OffsetPageInfo } from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

export interface AuditFilters {
  entity_type?: string;
  action?: string;
  user_id?: string;
  from?: string;
  to?: string;
  page?: number;
}

/** S5 — audit log với filter (offset paginate). */
export function useAuditLogs(filters: AuditFilters) {
  return useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(filters.page ?? 1) });
      if (filters.entity_type) p.set('entity_type', filters.entity_type);
      if (filters.action) p.set('action', filters.action);
      if (filters.user_id) p.set('user_id', filters.user_id);
      if (filters.from) p.set('from', filters.from);
      if (filters.to) p.set('to', filters.to);
      return apiClient.get<{ data: AuditLogResponse[]; page_info: OffsetPageInfo }>(
        `/audit-logs?${p.toString()}`,
      );
    },
    placeholderData: keepPreviousData,
  });
}
