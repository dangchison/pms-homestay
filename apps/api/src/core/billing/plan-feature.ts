import { SetMetadata } from '@nestjs/common';

/**
 * Khoá tính năng bật/tắt theo gói — khớp cột `subscription_plans.features` (JSONB)
 * do seed-prod-required.ts ghi. Union đóng để gõ sai key là lỗi biên dịch, không
 * phải endpoint mở toang trong im lặng.
 */
export const PLAN_FEATURES = [
  'ota_sync',
  'vietqr',
  'invoices',
  'compliance',
  'cleaning',
  'multi_property_reports',
  'assets',
  'shifts',
  'zns',
  'api_access',
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_FEATURE_KEY = 'planFeature';

/** Nhãn tiếng Việt cho thông báo cần nâng gói. */
export const PLAN_FEATURE_LABEL: Record<PlanFeature, string> = {
  ota_sync: 'đồng bộ kênh OTA',
  vietqr: 'thu tiền VietQR',
  invoices: 'hoá đơn',
  compliance: 'khai báo lưu trú và OCR CCCD',
  cleaning: 'dọn phòng và ứng dụng nhân viên',
  multi_property_reports: 'báo cáo hợp nhất nhiều cơ sở',
  assets: 'tài sản và khấu hao',
  shifts: 'bàn giao ca quầy',
  zns: 'tin nhắn ZNS',
  api_access: 'API và webhook',
};

/**
 * Endpoint chỉ mở cho gói có bật tính năng này. PlanFeatureGuard đọc gói hiện tại
 * của tenant và chặn 402 nếu tắt. Đặt cạnh @RequirePermissions — hai thứ khác nhau:
 * permission là "vai trò này được phép", plan feature là "gói này có mua".
 */
export const RequirePlanFeature = (feature: PlanFeature) =>
  SetMetadata(PLAN_FEATURE_KEY, feature);
