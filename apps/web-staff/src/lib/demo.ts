/**
 * Demo mode (marketing/partner): nút đăng nhập nhanh trên màn login web-staff. Bật
 * bằng NEXT_PUBLIC_DEMO_MODE=1 (local + bản demo); TẮT cho tenant thật. Creds là
 * tài khoản demo throwaway (tenant `demo`, khớp seed-dev) → công khai OK.
 */
export const DEMO_MODE =
  process.env.NEXT_PUBLIC_DEMO_MODE === '1' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export const DEMO_TENANT = 'demo';
export const DEMO_PASSWORD = 'Demo@2026!';
export const DEMO_ACCOUNTS = [
  { label: 'Lễ tân', email: 'letan@demo.vn' },
  { label: 'Buồng phòng', email: 'buongphong@demo.vn' },
] as const;
