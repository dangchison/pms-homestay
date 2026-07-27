/**
 * Demo mode (marketing/partner): bật nút đăng nhập 1-chạm trên trang login. Bật ở
 * local + bản demo (demo.pmsapp.vn) bằng NEXT_PUBLIC_DEMO_MODE=1; TẮT cho tenant
 * thật. Creds là tài khoản demo throwaway (tenant `demo`, khớp seed-dev) → công khai OK.
 */
export const DEMO_MODE =
  process.env.NEXT_PUBLIC_DEMO_MODE === '1' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export const DEMO_PASSWORD = 'Demo@2026!';
export const DEMO_OWNER = { email: 'owner@demo.vn', password: DEMO_PASSWORD } as const;
/**
 * Tenant chứa tài khoản demo. Nút demo PHẢI gửi kèm slug này: người dùng đã đăng
 * nhập tenant riêng trước đó sẽ có slug khác được ghi nhớ, và nút demo sẽ đi tìm
 * owner@demo.vn trong tenant của họ → 401.
 */
export const DEMO_TENANT_SLUG = 'demo';
