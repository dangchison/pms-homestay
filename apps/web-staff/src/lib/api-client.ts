import { type ApiError, type AuthTokensResponse } from '@pms/shared-types';
import { useAuthStore } from '@/stores/auth.store';
import { getTenantSlug } from './tenant';

/**
 * Fetch wrapper gọi thẳng API domain (docs/13 §3 — KHÔNG proxy qua Next), dùng
 * chung pattern với web-admin (task 6.1):
 * - Access token in-memory (auth store) → header `Authorization: Bearer`.
 * - `X-Tenant-Slug` cho auth-public (login/refresh).
 * - Refresh interceptor: 401 → POST /auth/refresh (CSRF double-submit) → retry 1 lần.
 *   Lock chống stampede khi nhiều request 401 cùng lúc.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError['error'] | undefined,
  ) {
    super(body?.title ?? `API error ${status}`);
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

function baseHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set('Content-Type', 'application/json');
  h.set('X-Request-Id', crypto.randomUUID());
  const slug = getTenantSlug();
  if (slug) h.set('X-Tenant-Slug', slug);
  const token = useAuthStore.getState().accessToken;
  if (token) h.set('Authorization', `Bearer ${token}`);
  return h;
}

// ── Refresh interceptor (1 lock dùng chung) ─────────────────────────────────
let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const csrf = useAuthStore.getState().csrfToken;
  const headers = new Headers({ 'X-Request-Id': crypto.randomUUID() });
  const slug = getTenantSlug();
  if (slug) headers.set('X-Tenant-Slug', slug);
  if (csrf) headers.set('X-CSRF-Token', csrf); // double-submit
  const res = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers,
  });
  if (!res.ok) {
    useAuthStore.getState().clear();
    return false;
  }
  const { data } = (await res.json()) as { data: AuthTokensResponse };
  useAuthStore.getState().setSession({
    accessToken: data.access_token,
    csrfToken: data.csrf_token,
    user: data.user,
  });
  return true;
}

/** Đảm bảo chỉ 1 refresh chạy tại 1 thời điểm. */
export function ensureRefreshed(): Promise<boolean> {
  refreshing ??= refreshSession().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request<T>(path: string, options: RequestOptions = {}, retry = true): Promise<T> {
  const { body, headers, ...rest } = options;
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...rest,
    credentials: 'include',
    headers: baseHeaders(headers),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const ok = await ensureRefreshed();
    if (ok) return request<T>(path, options, false); // retry 1 lần với token mới
  }

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => undefined)) as ApiError | undefined;
    throw new ApiClientError(res.status, errorBody?.error);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Tải nội dung nhị phân có auth (vd ảnh QR VietQR) → Blob. Refresh 1 lần như request(). */
async function requestBlob(path: string, retry = true): Promise<Blob> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    credentials: 'include',
    headers: baseHeaders(),
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const ok = await ensureRefreshed();
    if (ok) return requestBlob(path, false);
  }
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => undefined)) as ApiError | undefined;
    throw new ApiClientError(res.status, errorBody?.error);
  }
  return res.blob();
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  getBlob: (path: string) => requestBlob(path),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
};
