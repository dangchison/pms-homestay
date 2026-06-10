import { type ApiError } from '@pms/shared-types';

/**
 * Fetch wrapper gọi thẳng API domain (docs/13 §3 — KHÔNG proxy qua Next).
 * TODO(task 1.7): refresh interceptor (401 → POST /auth/refresh → retry 1 lần).
 * TODO(task 2.6): tự gắn If-Match từ version của entity với PATCH.
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;

  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...rest,
    // refresh cookie HTTP-only + CSRF double-submit (docs/13 §3)
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': crypto.randomUUID(),
      // TODO(task 1.7): Authorization: Bearer <access token in-memory>
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => undefined)) as ApiError | undefined;
    throw new ApiClientError(res.status, errorBody?.error);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
