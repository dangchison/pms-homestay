import { type ApiError } from '@pms/shared-types';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Fetch wrapper gọi thẳng API domain. Khác web-admin ở ba chỗ, đều do platform là
 * danh tính riêng: không `X-Tenant-Slug`, không CSRF/cookie refresh, và 401 KHÔNG
 * retry — token nền tảng hết hạn thì đăng nhập lại (BE không có refresh cho nó).
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError['error'] | undefined,
  ) {
    super(ApiClientError.describe(status, body));
  }

  private static describe(status: number, body: ApiError['error'] | undefined): string {
    const title = body?.title ?? `API error ${status}`;
    const detail = body?.detail;
    const fields = body?.fields;
    if (fields?.length) return `${title}: ${fields.map((f) => f.message).join('; ')}`;
    return detail ? `${title} — ${detail}` : title;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json');
  h.set('X-Request-Id', crypto.randomUUID());
  const token = useAuthStore.getState().accessToken;
  if (token) h.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...rest,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Token hết hạn giữa chừng → đá về màn đăng nhập thay vì để UI treo lỗi khó hiểu.
  if (res.status === 401 && !path.startsWith('/platform/auth/')) {
    useAuthStore.getState().clear();
  }

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => undefined)) as ApiError | undefined;
    throw new ApiClientError(res.status, errorBody?.error);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
};
