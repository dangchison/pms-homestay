/**
 * Tenant slug cho client-side fetch (docs/13 §3). API client gắn vào header
 * `X-Tenant-Slug`; BE resolve tenant từ header này cho auth-public (login,
 * register, quên mật khẩu).
 *
 * Thứ tự ưu tiên — subdomain → slug đã ghi nhớ → mặc định môi trường:
 *
 * 1. Subdomain (`bien-xanh.pmsapp.vn` → `bien-xanh`) — nguồn tin cậy nhất.
 * 2. Slug ghi nhớ trên máy, đặt khi đăng ký hoặc đăng nhập THÀNH CÔNG.
 * 3. `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` — chỉ là lối thoát cho dev/demo.
 *
 * Bước 2 tồn tại vì `users` unique theo `(tenant_id, email)` chứ KHÔNG unique
 * toàn cục: BE không thể suy ra tenant từ email, buộc FE phải nói rõ. Thiếu bước
 * này thì trên localhost (không subdomain) mọi lần đăng nhập đều rơi về `demo`,
 * và người vừa đăng ký tenant riêng nhận "Email hoặc mật khẩu không đúng" dù
 * mật khẩu hoàn toàn đúng — chỉ vì tìm nhầm tenant.
 */
const SYSTEM_SUBDOMAINS = new Set(['www', 'api', 'app', 'admin', 'staff']);
const STORAGE_KEY = 'pms.tenant_slug';

function envDefault(): string | undefined {
  return process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || undefined;
}

/** Slug suy từ subdomain — `undefined` khi chạy localhost hoặc trên host hệ thống. */
export function getSubdomainTenantSlug(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const parts = window.location.hostname.split('.');
  const sub = parts.length >= 3 ? parts[0] : undefined;
  return sub && !SYSTEM_SUBDOMAINS.has(sub) ? sub : undefined;
}

function readStored(): string | undefined {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || undefined;
  } catch {
    return undefined; // Safari riêng tư / trình duyệt chặn storage
  }
}

export function getTenantSlug(): string | undefined {
  if (typeof window === 'undefined') return envDefault();
  return getSubdomainTenantSlug() ?? readStored() ?? envDefault();
}

/**
 * Ghi nhớ tenant cho các phiên sau trên cùng thiết bị. Chỉ gọi khi đã CHẮC slug
 * đúng (đăng ký thành công, đăng nhập thành công) — ghi nhớ slug sai sẽ khoá
 * người dùng khỏi chính tenant của họ ở lần vào sau.
 */
export function rememberTenantSlug(slug: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    /* không ghi nhớ được thì thôi — người dùng nhập lại ở ô "Không gian làm việc" */
  }
}
