import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChannelMappingResponse,
  ChannelResponse,
  CreateChannelMappingRequest,
  CreateChannelRequest,
  IcalSyncResult,
  SyncJobResponse,
  UpdateChannelMappingRequest,
  UpdateChannelRequest,
} from '@pms/shared-types';
import { apiClient } from '@/lib/api-client';

/**
 * Kênh OTA iCal + mapping listing + lịch sử sync (task 1.6 /channels, docs/19 §2 Đợt 1).
 * Endpoint theo BE: kênh ở /channels/:id, thao tác PER-MAPPING (sync / regenerate-token /
 * update / delete) ở /channel-mappings/:id — tách path để tránh va route (channel-mappings.controller).
 * KHÔNG có SSE riêng cho ['channels', mappings/sync-jobs] → realtime dựa onSuccess invalidate
 * của mutation (đủ cho luồng người dùng tự thao tác; docs/19 §1.6 risks). Secret kênh mã hoá ở
 * BE (api_key_enc AES-256-GCM) — response chỉ trả has_secret, KHÔNG có plaintext.
 */

// ── Queries ────────────────────────────────────────────────────────────────
export function useChannels(propertyId: string | null) {
  return useQuery({
    queryKey: ['channels', 'list', propertyId],
    queryFn: () =>
      apiClient
        .get<{ data: ChannelResponse[] }>(`/channels?property_id=${propertyId!}`)
        .then((r) => r.data),
    enabled: propertyId != null,
  });
}

export function useChannelMappings(channelId: string) {
  return useQuery({
    queryKey: ['channels', channelId, 'mappings'],
    queryFn: () =>
      apiClient
        .get<{ data: ChannelMappingResponse[] }>(`/channels/${channelId}/mappings`)
        .then((r) => r.data),
    enabled: !!channelId,
  });
}

export function useChannelSyncJobs(channelId: string) {
  return useQuery({
    queryKey: ['channels', channelId, 'sync-jobs'],
    queryFn: () =>
      apiClient
        .get<{ data: SyncJobResponse[] }>(`/channels/${channelId}/sync-jobs`)
        .then((r) => r.data),
    enabled: !!channelId,
  });
}

// ── Channel mutations ──────────────────────────────────────────────────────
export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChannelRequest) =>
      apiClient.post<{ data: ChannelResponse }>('/channels', body).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels'] }),
  });
}

export function useUpdateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateChannelRequest) =>
      apiClient.patch<{ data: ChannelResponse }>(`/channels/${id}`, body).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels'] }),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/channels/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels'] }),
  });
}

// ── Mapping mutations (nested tạo dưới /channels/:id/mappings) ──────────────
export function useCreateChannelMapping(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChannelMappingRequest) =>
      apiClient
        .post<{ data: ChannelMappingResponse }>(`/channels/${channelId}/mappings`, body)
        .then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels', channelId, 'mappings'] }),
  });
}

export function useUpdateChannelMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateChannelMappingRequest) =>
      apiClient
        .patch<{ data: ChannelMappingResponse }>(`/channel-mappings/${id}`, body)
        .then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels'] }),
  });
}

export function useDeleteChannelMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<void>(`/channel-mappings/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels'] }),
  });
}

/** Sinh lại ical_push_token của 1 mapping (thu hồi token cũ) → refetch mappings của kênh. */
export function useRegenerateToken(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mappingId: string) =>
      apiClient
        .post<{ data: ChannelMappingResponse }>(`/channel-mappings/${mappingId}/regenerate-token`)
        .then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels', channelId, 'mappings'] }),
  });
}

/** Sync ngay 1 mapping (fetch iCal pull + áp feed) → refetch sync-jobs & mappings của kênh. */
export function useSyncMapping(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mappingId: string) =>
      apiClient
        .post<{ data: IcalSyncResult }>(`/channel-mappings/${mappingId}/sync`)
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['channels', channelId, 'sync-jobs'] });
      void qc.invalidateQueries({ queryKey: ['channels', channelId, 'mappings'] });
    },
  });
}
