/**
 * Tenant slug cho web-staff (docs/13 §3, ui/02 #T1). KHÁC web-admin: nhân viên
 * nhập slug ở màn đăng nhập → lưu localStorage để nhớ cho lần sau + gắn vào
 * `X-Tenant-Slug` cho login. Sau đăng nhập, mọi request có Bearer nên BE resolve
 * tenant từ token; slug header chỉ cần cho auth-public (login/refresh).
 */
const KEY = 'pms.staff.tenant_slug';
const SYSTEM_SUBDOMAINS = new Set(['www', 'api', 'app', 'admin', 'staff']);

export function getTenantSlug(): string | undefined {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(KEY);
    if (stored) return stored;
    const parts = window.location.hostname.split('.');
    const sub = parts.length >= 3 ? parts[0] : undefined;
    if (sub && !SYSTEM_SUBDOMAINS.has(sub)) return sub;
  }
  return process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || undefined;
}

/** Lưu slug nhân viên vừa nhập (gọi TRƯỚC login). */
export function setTenantSlug(slug: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(KEY, slug.trim());
}

/** Slug đã nhớ (prefill ô đăng nhập). */
export function rememberedTenantSlug(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(KEY) ?? '';
}
