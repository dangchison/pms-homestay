import { type Client } from 'pg';

/**
 * Đổi gói thuê bao của tenant thẳng trong DB — dùng cho spec kiểm tính năng chỉ
 * có ở gói cao (assets, shifts…). Đăng ký mặc định vào trial mức STARTER, nên
 * spec nào chạm tính năng PRO+ phải nâng gói trước, nếu không PlanFeatureGuard
 * trả 402.
 *
 * Gọi TRƯỚC request gated đầu tiên: PlanFeatureService cache 60s và chỉ ghi cache
 * khi đọc, nên tenant vừa tạo chưa có gì để invalidate.
 */
export async function setTenantPlan(
  admin: Client,
  tenantSlug: string,
  planCode: 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE',
): Promise<void> {
  await admin.query(
    `UPDATE tenants
        SET subscription_plan_id = (SELECT id FROM subscription_plans WHERE code = $2)
      WHERE slug = $1`,
    [tenantSlug, planCode],
  );
}
