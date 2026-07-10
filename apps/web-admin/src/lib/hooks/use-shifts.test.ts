import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock apiClient: mọi hook đi qua đây → assert path/body/headers. Hook shifts chỉ
// dùng get/post (không patch/toast) — mock đúng bấy nhiêu (harness như use-bookings.test).
const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));

import { useCloseShift, useOpenShift, useShift, useShifts } from './use-shifts';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  get.mockResolvedValue({ data: [], page_info: {} });
  post.mockResolvedValue({ data: {} });
});
afterEach(() => {
  vi.clearAllMocks();
});

const ID = '11111111-1111-1111-1111-111111111111';
const PROP = '22222222-2222-2222-2222-222222222222';
const KEY = '33333333-3333-3333-3333-333333333333';

describe('useShifts', () => {
  it('GET /shifts?property_id=<id>&page=1 (page_size để BE default)', async () => {
    renderHook(() => useShifts(PROP), { wrapper: wrapper() });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith(`/shifts?property_id=${PROP}&page=1`);
  });

  it('enabled=false khi propertyId null → KHÔNG gọi', async () => {
    renderHook(() => useShifts(null), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 20));
    expect(get).not.toHaveBeenCalled();
  });
});

describe('useShift', () => {
  it('GET /shifts/<id>', async () => {
    get.mockResolvedValue({ data: {} });
    renderHook(() => useShift(ID), { wrapper: wrapper() });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith(`/shifts/${ID}`);
  });

  it('enabled=false khi id rỗng → KHÔNG gọi', async () => {
    renderHook(() => useShift(''), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 20));
    expect(get).not.toHaveBeenCalled();
  });
});

describe('useOpenShift', () => {
  it('POST /shifts với header Idempotency-Key; body = {property_id, opening_float_vnd, note} (KHÔNG variance/expected)', async () => {
    const { result } = renderHook(() => useOpenShift(), { wrapper: wrapper() });
    const body = { property_id: PROP, opening_float_vnd: 500000, note: 'tiền đầu ca' };
    await result.current.mutateAsync({ body, idempotencyKey: KEY });

    expect(post).toHaveBeenCalledWith('/shifts', body, { headers: { 'Idempotency-Key': KEY } });
    const sentBody = post.mock.calls[0]![1] as Record<string, unknown>;
    expect(sentBody).not.toHaveProperty('variance_vnd');
    expect(sentBody).not.toHaveProperty('expected_cash_vnd');
  });
});

describe('useCloseShift', () => {
  it('POST /shifts/<id>/close với header If-Match=String(version); body = {closing_counted_vnd, note} (KHÔNG variance/expected)', async () => {
    const { result } = renderHook(() => useCloseShift(), { wrapper: wrapper() });
    const body = { closing_counted_vnd: 2380000, note: 'đếm cuối ca' };
    await result.current.mutateAsync({ id: ID, version: 3, body });

    expect(post).toHaveBeenCalledWith(`/shifts/${ID}/close`, body, { headers: { 'If-Match': '3' } });
    const sentBody = post.mock.calls[0]![1] as Record<string, unknown>;
    expect(sentBody).not.toHaveProperty('variance_vnd');
    expect(sentBody).not.toHaveProperty('expected_cash_vnd');
  });
});
