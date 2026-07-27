import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignRatePlanResourcesRequest,
  BookingMode,
  CreateRatePlanRequest,
  CreateRatePlanRuleRequest,
  RatePlanResponse,
  RatePlanRuleResponse,
  UpdateRatePlanRequest,
  UpdateRatePlanRuleRequest,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Gói giá + luật giá (tab "Gói giá" trong /properties). Endpoint theo BE
 * rate-plans.controller: gói ở /rate-plans/:id, luật NESTED ở /rate-plans/:id/rules/:ruleId.
 *
 * Sửa gói làm BE bump `version`; báo giá đã lưu so version khi tạo booking → sau mọi
 * mutation phải invalidate cả ['quote'] để phần thử giá không hiện số cũ.
 *
 * KHÔNG có SSE cho rate-plans → realtime dựa onSuccess invalidate (đủ cho luồng
 * người dùng tự thao tác, giống use-channels.ts).
 */

const KEY = 'rate-plans';

/** Invalidate mọi thứ phụ thuộc gói giá (list + chi tiết + luật + báo giá thử). */
function useInvalidateRatePlans() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: [KEY] });
    void qc.invalidateQueries({ queryKey: ['quote'] });
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Gói giá của cơ sở — dùng cho onboarding D1 ("đã cấu hình gói giá chưa") và tab Gói giá. */
export function useRatePlans(propertyId: string | null, mode?: BookingMode) {
  return useQuery({
    queryKey: [KEY, propertyId ?? '', mode ?? 'ALL'],
    queryFn: () => {
      const qs = new URLSearchParams({ property_id: propertyId! });
      if (mode) qs.set('mode', mode);
      return apiClient
        .get<{ data: RatePlanResponse[] }>(`/rate-plans?${qs.toString()}`)
        .then((r) => r.data);
    },
    enabled: !!propertyId,
  });
}

/** Chi tiết 1 gói — response getById có kèm `rules` (list thì không). */
export function useRatePlan(id: string | null) {
  return useQuery({
    queryKey: [KEY, 'detail', id ?? ''],
    queryFn: () =>
      apiClient.get<{ data: RatePlanResponse }>(`/rate-plans/${id!}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useRatePlanRules(planId: string | null) {
  return useQuery({
    queryKey: [KEY, 'detail', planId ?? '', 'rules'],
    queryFn: () =>
      apiClient
        .get<{ data: RatePlanRuleResponse[] }>(`/rate-plans/${planId!}/rules`)
        .then((r) => r.data),
    enabled: !!planId,
  });
}

// ── Mutations gói ────────────────────────────────────────────────────────────

export function useCreateRatePlan() {
  const invalidate = useInvalidateRatePlans();
  return useMutation({
    mutationFn: (body: CreateRatePlanRequest) =>
      apiClient.post<{ data: RatePlanResponse }>('/rate-plans', body).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateRatePlan() {
  const invalidate = useInvalidateRatePlans();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateRatePlanRequest) =>
      apiClient.patch<{ data: RatePlanResponse }>(`/rate-plans/${id}`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteRatePlan() {
  const invalidate = useInvalidateRatePlans();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/rate-plans/${id}`),
    onSuccess: invalidate,
  });
}

/** PUT (không PATCH) — gửi danh sách đầy đủ, mảng rỗng = gỡ hết resource khỏi gói. */
export function useAssignRatePlanResources() {
  const invalidate = useInvalidateRatePlans();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & AssignRatePlanResourcesRequest) =>
      apiClient
        .put<{ data: RatePlanResponse }>(`/rate-plans/${id}/resources`, body)
        .then((r) => r.data),
    onSuccess: invalidate,
  });
}

// ── Mutations luật giá (nested dưới /rate-plans/:planId/rules) ────────────────

export function useCreateRatePlanRule(planId: string) {
  const invalidate = useInvalidateRatePlans();
  return useMutation({
    mutationFn: (body: CreateRatePlanRuleRequest) =>
      apiClient
        .post<{ data: RatePlanRuleResponse }>(`/rate-plans/${planId}/rules`, body)
        .then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateRatePlanRule(planId: string) {
  const invalidate = useInvalidateRatePlans();
  return useMutation({
    mutationFn: ({ ruleId, ...body }: { ruleId: string } & UpdateRatePlanRuleRequest) =>
      apiClient
        .patch<{ data: RatePlanRuleResponse }>(`/rate-plans/${planId}/rules/${ruleId}`, body)
        .then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteRatePlanRule(planId: string) {
  const invalidate = useInvalidateRatePlans();
  return useMutation({
    mutationFn: (ruleId: string) =>
      apiClient.delete<void>(`/rate-plans/${planId}/rules/${ruleId}`),
    onSuccess: invalidate,
  });
}
