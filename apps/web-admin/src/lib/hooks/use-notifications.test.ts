import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationResponse } from '@pms/shared-types';

// Mock apiClient: hook chỉ dùng get/post → assert path + body (harness như use-shifts.test).
const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));

import { unreadCount, useMarkNotificationRead, useNotifications } from './use-notifications';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  get.mockResolvedValue({ data: [] });
  post.mockResolvedValue({ data: {} });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const ID = '11111111-1111-1111-1111-111111111111';
const ID2 = '22222222-2222-2222-2222-222222222222';

function notif(over: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
    id: ID,
    channel: 'IN_APP',
    title: 'Đặt phòng mới',
    body: 'Phòng 101 vừa được đặt',
    metadata: {},
    is_read: false,
    read_at: null,
    created_at: '2026-07-10T00:00:00.000Z',
    ...over,
  };
}

describe('useNotifications', () => {
  it('GET /notifications?limit=20 và trả res.data (mảng đã bóc {data})', async () => {
    const rows = [notif(), notif({ id: ID2, is_read: true, read_at: '2026-07-10T01:00:00.000Z' })];
    get.mockResolvedValue({ data: rows });
    const { result } = renderHook(() => useNotifications(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/notifications?limit=20');
    expect(result.current.data).toEqual(rows);
  });
});

describe('useMarkNotificationRead', () => {
  it('POST /notifications/<id>/read (body undefined) + invalidate [notifications] onSuccess', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockResolvedValue(undefined);
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper: wrapper() });
    await result.current.mutateAsync(ID);
    expect(post).toHaveBeenCalledWith(`/notifications/${ID}/read`, undefined);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['notifications'] });
  });
});

describe('unreadCount', () => {
  it('trả 0 cho mảng rỗng', () => {
    expect(unreadCount([])).toBe(0);
  });
  it('đếm đúng số is_read === false (3 dòng, 2 chưa đọc)', () => {
    const items = [notif(), notif({ id: ID2, is_read: true }), notif()];
    expect(unreadCount(items)).toBe(2);
  });
});
