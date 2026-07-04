import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock apiClient: mọi hook đi qua đây → assert path/body/headers. toast của @pms/ui
// được gọi trong onError một số mutation → mock để không cần DOM portal.
const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
  },
  // useUpdateBooking/switch/reschedule dùng ApiClientError để phân nhánh onError.
  ApiClientError: class ApiClientError extends Error {
    constructor(
      readonly status: number,
      readonly body: { code?: string } | undefined,
    ) {
      super(body?.code ?? `err ${status}`);
    }
  },
}));
vi.mock('@pms/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  useBooking,
  useBookingActions,
  useGuest,
  useInvoicesByBooking,
  useRescheduleBookingDetail,
  useSwitchBookingResource,
  useUpdateBooking,
} from './use-bookings';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  get.mockResolvedValue({ data: {} });
  post.mockResolvedValue({ data: {} });
  patch.mockResolvedValue({ data: {} });
});
afterEach(() => {
  vi.clearAllMocks();
});

const ID = '11111111-1111-1111-1111-111111111111';

describe('useBooking', () => {
  it('GET /bookings/<id>', async () => {
    renderHook(() => useBooking(ID), { wrapper: wrapper() });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith(`/bookings/${ID}`);
  });
});

describe('useInvoicesByBooking', () => {
  it('GET /invoices?booking_id=<id>', async () => {
    renderHook(() => useInvoicesByBooking(ID), { wrapper: wrapper() });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith(`/invoices?booking_id=${ID}`);
  });
});

describe('useGuest', () => {
  it('GET /guests/<id>', async () => {
    renderHook(() => useGuest(ID), { wrapper: wrapper() });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith(`/guests/${ID}`);
  });

  it('enabled=false khi id rỗng → KHÔNG gọi', async () => {
    renderHook(() => useGuest(''), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 20));
    expect(get).not.toHaveBeenCalled();
  });
});

describe('useBookingActions', () => {
  it('confirm → POST /bookings/<id>/confirm body {force:false}', async () => {
    const { result } = renderHook(() => useBookingActions(), { wrapper: wrapper() });
    await result.current.confirm.mutateAsync({ id: ID });
    expect(post).toHaveBeenCalledWith(`/bookings/${ID}/confirm`, { force: false });
  });

  it('cancel → POST /bookings/<id>/cancel body {reason}', async () => {
    const { result } = renderHook(() => useBookingActions(), { wrapper: wrapper() });
    await result.current.cancel.mutateAsync({ id: ID, reason: 'khách đổi ý' });
    expect(post).toHaveBeenCalledWith(`/bookings/${ID}/cancel`, { reason: 'khách đổi ý' });
  });

  it('checkIn → POST /bookings/<id>/check-in KHÔNG gửi body', async () => {
    const { result } = renderHook(() => useBookingActions(), { wrapper: wrapper() });
    await result.current.checkIn.mutateAsync({ id: ID });
    // 1 tham số duy nhất (path) → body omitted (undefined khi tới apiClient.post).
    expect(post).toHaveBeenCalledWith(`/bookings/${ID}/check-in`);
    expect(post.mock.calls[0]).toHaveLength(1);
  });

  it('checkOut → POST /bookings/<id>/check-out KHÔNG gửi body', async () => {
    const { result } = renderHook(() => useBookingActions(), { wrapper: wrapper() });
    await result.current.checkOut.mutateAsync({ id: ID });
    expect(post).toHaveBeenCalledWith(`/bookings/${ID}/check-out`);
    expect(post.mock.calls[0]).toHaveLength(1);
  });
});

describe('useUpdateBooking', () => {
  it('PATCH /bookings/<id> gửi header If-Match = version', async () => {
    const { result } = renderHook(() => useUpdateBooking(), { wrapper: wrapper() });
    await result.current.mutateAsync({ id: ID, version: 7, body: { notes: 'ghi chú' } });
    expect(patch).toHaveBeenCalledWith(`/bookings/${ID}`, { notes: 'ghi chú' }, {
      headers: { 'If-Match': '7' },
    });
  });
});

describe('useSwitchBookingResource', () => {
  it('POST /bookings/<id>/switch-resource body có new_resource_id + reason', async () => {
    const RES = '22222222-2222-2222-2222-222222222222';
    const { result } = renderHook(() => useSwitchBookingResource(), { wrapper: wrapper() });
    await result.current.mutateAsync({ id: ID, new_resource_id: RES, reason: 'đổi phòng' });
    expect(post).toHaveBeenCalledWith(`/bookings/${ID}/switch-resource`, {
      new_resource_id: RES,
      reason: 'đổi phòng',
    });
  });
});

describe('useRescheduleBookingDetail', () => {
  it('POST /bookings/<id>/reschedule body có check_in/check_out/reason', async () => {
    const { result } = renderHook(() => useRescheduleBookingDetail(), { wrapper: wrapper() });
    await result.current.mutateAsync({
      id: ID,
      check_in: '2026-08-01T06:00:00.000Z',
      check_out: '2026-08-03T04:00:00.000Z',
      reason: 'đổi lịch',
    });
    expect(post).toHaveBeenCalledWith(`/bookings/${ID}/reschedule`, {
      check_in: '2026-08-01T06:00:00.000Z',
      check_out: '2026-08-03T04:00:00.000Z',
      reason: 'đổi lịch',
    });
  });
});
