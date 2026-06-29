import { SetMetadata } from '@nestjs/common';

export const AUDIT_EXPORT_KEY = 'audit_export';

/**
 * Đánh dấu 1 endpoint GET là "xuất dữ liệu" (báo cáo Excel/PDF…) → AuditInterceptor
 * ghi action EXPORT (GET không tự audit như mutation). after_data = query string
 * (bộ lọc đã xuất: from/to/property_id — KHÔNG chứa PII). Dùng cho B3 (docs/18).
 */
export const AuditExport = (): MethodDecorator => SetMetadata(AUDIT_EXPORT_KEY, true);
