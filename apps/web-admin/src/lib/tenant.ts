/**
 * Tenant slug cho client-side fetch (docs/13 §3): suy từ subdomain
 * (`tenant.pmsapp.vn` → `tenant`); localhost/dev không có subdomain → fallback
 * `NEXT_PUBLIC_DEFAULT_TENANT_SLUG`. API client gắn vào header `X-Tenant-Slug`
 * (BE resolve tenant từ header — auth-public dùng cho login/register).
 */
const SYSTEM_SUBDOMAINS = new Set(['www', 'api', 'app', 'admin', 'staff']);

export function getTenantSlug(): string | undefined {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const parts = host.split('.');
    const sub = parts.length >= 3 ? parts[0] : undefined;
    if (sub && !SYSTEM_SUBDOMAINS.has(sub)) return sub;
  }
  return process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || undefined;
}
