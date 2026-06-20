import { type AuthTokensResponse, type LoginRequest, type UserRole } from '@pms/shared-types';
import { useAuthStore } from '@/stores/auth.store';
import { apiClient, ensureRefreshed } from './api-client';
import { getQueryClient } from './query-client';
import { setTenantSlug } from './tenant';

/**
 * Đăng nhập nhân viên (ui/02 #T1): lưu tenant slug vừa nhập (cho login + nhớ lần
 * sau) → lưu access/csrf/user in-memory (refresh cookie BE tự set, sống 30 ngày).
 */
export async function login(tenantSlug: string, input: LoginRequest): Promise<UserRole> {
  setTenantSlug(tenantSlug);
  const { data } = await apiClient.post<{ data: AuthTokensResponse }>('/auth/login', input);
  useAuthStore.getState().setSession({
    accessToken: data.access_token,
    csrfToken: data.csrf_token,
    user: data.user,
  });
  return data.user.role;
}

/** Trang chủ theo vai: buồng phòng vào thẳng /cleaning (không có quyền xem bảng hôm nay). */
export function landingPathForRole(role?: UserRole): string {
  return role === 'HOUSEKEEPER' ? '/cleaning' : '/today';
}

/** Đăng xuất → thu hồi refresh token (CSRF double-submit) + xoá session in-memory. */
export async function logout(): Promise<void> {
  const csrf = useAuthStore.getState().csrfToken;
  await apiClient
    .post('/auth/logout', undefined, csrf ? { headers: { 'X-CSRF-Token': csrf } } : undefined)
    .catch(() => undefined); // best-effort: vẫn xoá local dù BE lỗi
  useAuthStore.getState().clear();
  getQueryClient().clear(); // xoá cache REST → đổi vai trên thiết bị chung không thấy dữ liệu phiên trước
}

/**
 * Khôi phục phiên khi mở app: thử refresh từ cookie HttpOnly. Đặt status
 * authenticated/unauthenticated để AuthGate quyết định redirect.
 */
export async function bootstrapSession(): Promise<void> {
  if (useAuthStore.getState().status !== 'idle') return;
  const ok = await ensureRefreshed();
  if (!ok) useAuthStore.getState().clear(); // chắc chắn về unauthenticated
}
