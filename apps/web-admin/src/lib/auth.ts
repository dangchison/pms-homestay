import { type AuthTokensResponse, type LoginRequest } from '@pms/shared-types';
import { useAuthStore } from '@/stores/auth.store';
import { apiClient, ensureRefreshed } from './api-client';
import { getQueryClient } from './query-client';

/** Đăng nhập → lưu access/csrf/user in-memory (refresh cookie BE tự set). */
export async function login(input: LoginRequest): Promise<void> {
  const { data } = await apiClient.post<{ data: AuthTokensResponse }>('/auth/login', input);
  useAuthStore.getState().setSession({
    accessToken: data.access_token,
    csrfToken: data.csrf_token,
    user: data.user,
  });
}

/** Đăng xuất → thu hồi refresh token (CSRF double-submit) + xoá session in-memory. */
export async function logout(): Promise<void> {
  const csrf = useAuthStore.getState().csrfToken;
  await apiClient
    .post('/auth/logout', undefined, csrf ? { headers: { 'X-CSRF-Token': csrf } } : undefined)
    .catch(() => undefined); // best-effort: vẫn xoá local dù BE lỗi
  useAuthStore.getState().clear();
  getQueryClient().clear(); // xoá cache REST → đổi tài khoản trên cùng thiết bị không thấy dữ liệu phiên trước
}

/**
 * Khôi phục phiên khi mở app: thử refresh từ cookie HttpOnly. Đặt status
 * authenticated/unauthenticated để auth-gate quyết định redirect.
 */
export async function bootstrapSession(): Promise<void> {
  if (useAuthStore.getState().status !== 'idle') return;
  const ok = await ensureRefreshed();
  if (!ok) useAuthStore.getState().clear(); // chắc chắn về unauthenticated
}
