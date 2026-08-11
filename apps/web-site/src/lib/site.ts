import { type SubscriptionPlan } from '@pms/shared-types';

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3004';

export const REGISTER_URL = `${APP_URL}/register`;
export const LOGIN_URL = `${APP_URL}/login`;

/**
 * Liên hệ — thay bằng thông tin thật trước khi mở public. Để rỗng thì trang tự
 * ẩn mục đó thay vì hiện chỗ trống; kiểu string (không `as const`) để chỗ dùng
 * còn kiểm được rỗng hay không.
 */
export const CONTACT: { email: string; phone: string; company: string } = {
  email: 'hello@pmshomestay.vn',
  phone: '',
  company: '',
};

/** Nhãn tiếng Việt của gói; API chỉ trả `code`. */
export const PLAN_LABEL: Record<string, string> = {
  FREE: 'Miễn phí',
  STARTER: 'Khởi nghiệp',
  PRO: 'Chuyên nghiệp',
  ENTERPRISE: 'Doanh nghiệp',
};

/** Một dòng mô tả ai nên dùng gói nào — quyết định nhanh, không phải bảng tick. */
export const PLAN_FOR: Record<string, string> = {
  FREE: 'Một căn nhỏ, tự làm hết, muốn thử trước khi tin.',
  STARTER: 'Một cơ sở tới 15 phòng, có thể có một hai người phụ.',
  PRO: 'Nhiều cơ sở, có nhân viên, cần P&L hợp nhất.',
  ENTERPRISE: 'Chuỗi lớn hoặc cần tích hợp riêng.',
};

export function vnd(n: number): string {
  return n.toLocaleString('vi-VN') + ' ₫';
}

/** Giá 0 ở gói trả phí nghĩa là "liên hệ", không phải miễn phí. */
export function priceLabel(plan: Pick<SubscriptionPlan, 'code' | 'monthly_price_vnd'>): string {
  if (plan.code === 'FREE') return '0 ₫';
  return plan.monthly_price_vnd > 0 ? vnd(plan.monthly_price_vnd) : 'Liên hệ';
}

/**
 * Bảng giá đọc từ API để không lệch với hạn mức hệ thống đang chặn thật.
 * ISR 1 giờ. API chết thì trả mảng rỗng — trang render lời nhắn liên hệ chứ
 * không bịa số; giá sai còn tệ hơn không có giá.
 */
export async function fetchPlans(): Promise<SubscriptionPlan[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/public/plans`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const body = (await res.json()) as { data: SubscriptionPlan[] };
    return body.data ?? [];
  } catch {
    return [];
  }
}
