import { SetMetadata } from '@nestjs/common';
import { type PlanFeature } from '@pms/shared-types';

/**
 * Danh sách khoá tính năng + nhãn nằm ở `@pms/shared-types` (PlanFeatureSchema,
 * PLAN_FEATURE_LABEL): web-platform bật/tắt và web-site liệt kê bảng giá đều
 * phải khớp cùng một danh sách, để lệch là bán một đằng gác một nẻo.
 */
export const PLAN_FEATURE_KEY = 'planFeature';

/**
 * Endpoint chỉ mở cho gói có bật tính năng này. PlanFeatureGuard đọc gói hiện tại
 * của tenant và chặn 402 nếu tắt. Đặt cạnh @RequirePermissions — hai thứ khác nhau:
 * permission là "vai trò này được phép", plan feature là "gói này có mua".
 */
export const RequirePlanFeature = (feature: PlanFeature) => SetMetadata(PLAN_FEATURE_KEY, feature);
