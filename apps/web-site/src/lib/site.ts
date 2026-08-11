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
  PRO: 'Nhiều cơ sở, có nhân viên, cần báo cáo lãi lỗ hợp nhất.',
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
 * Bảng giá đọc từ API để không lệch với hạn mức hệ thống đang chặn thật. ISR 1 giờ.
 *
 * Lỗi thì NÉM, không trả mảng rỗng: trả rỗng nghĩa là lần render đó thành công và
 * ISR đóng băng trang không-có-giá suốt một tiếng — một cú nấc 5 giây của API xoá
 * bảng giá khỏi trang bán hàng 60 phút. Ném thì Next giữ nguyên bản tốt trước đó
 * và thử lại ở lượt sau. Chỉ lần build đầu tiên mới thực sự không có gì để giữ,
 * và lúc đó `PlanGrid` hiện lối liên hệ.
 */
export async function fetchPlans(): Promise<SubscriptionPlan[]> {
  const res = await fetch(`${API_URL}/api/v1/public/plans`, {
    next: { revalidate: 3600 },
    // API treo thì render treo theo — cắt sớm để lượt sau còn thử lại.
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`GET /public/plans → ${res.status}`);
  const body = (await res.json()) as { data: SubscriptionPlan[] };
  if (!Array.isArray(body.data)) throw new Error('GET /public/plans: thiếu mảng data');
  return body.data;
}

/** Bọc cho trang: lần build đầu chưa có bản cũ để giữ thì đành render rỗng. */
export async function fetchPlansOrEmpty(): Promise<SubscriptionPlan[]> {
  try {
    return await fetchPlans();
  } catch {
    return [];
  }
}
