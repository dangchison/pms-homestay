import { type AuthTokensResponse, type LoginRequest } from '@pms/shared-types';
import { useAuthStore } from '@/stores/auth.store';
import { usePropertyStore } from '@/stores/property.store';
import { apiClient, ensureRefreshed, readCsrfToken } from './api-client';
import { getQueryClient } from './query-client';
import { rememberTenantSlug } from './tenant';

/**
 * Đăng nhập → lưu access/csrf/user in-memory (refresh cookie BE tự set).
 *
 * `tenantSlug` để trang login chỉ định tenant khi không có subdomain. Chỉ ghi nhớ
 * SAU khi BE nhận — slug sai mà ghi nhớ thì lần vào sau vẫn hỏng, và người dùng
 * không có cách nào biết vì lỗi trả về là "sai mật khẩu".
 */
export async function login(input: LoginRequest, tenantSlug?: string): Promise<void> {
  const { data } = await apiClient.post<{ data: AuthTokensResponse }>(
    '/auth/login',
    input,
    tenantSlug ? { headers: { 'X-Tenant-Slug': tenantSlug } } : undefined,
  );
  if (tenantSlug) rememberTenantSlug(tenantSlug);
  useAuthStore.getState().setSession({
    accessToken: data.access_token,
    csrfToken: data.csrf_token,
    user: data.user,
  });
}

/** Đăng xuất → thu hồi refresh token (CSRF double-submit) + xoá session in-memory. */
export async function logout(): Promise<void> {
  const csrf = readCsrfToken(); // in-memory rỗng sau reload → lấy từ cookie
  await apiClient
    .post('/auth/logout', undefined, csrf ? { headers: { 'X-CSRF-Token': csrf } } : undefined)
    .catch(() => undefined); // best-effort: vẫn xoá local dù BE lỗi
  useAuthStore.getState().clear();
  getQueryClient().clear(); // xoá cache REST → đổi tài khoản trên cùng thiết bị không thấy dữ liệu phiên trước
  usePropertyStore.getState().clearSelected(); // cơ sở ghi nhớ thuộc về người vừa đăng xuất
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
