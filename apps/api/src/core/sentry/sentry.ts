import * as Sentry from '@sentry/node';
import { type Env } from '@core/config/env.schema';

/**
 * Error tracking qua Sentry (docs/11 §3) — auto-capture HTTP 5xx + unhandled
 * exception/rejection; manual capture lỗi nghiệp vụ đáng chú ý. Mỗi event gắn
 * `request_id` + `tenant_id`.
 *
 * ⚠️ App đã chạy `@opentelemetry/sdk-node` riêng (@core/otel). Sentry KHÔNG được
 * dựng OTel lần 2 (xung đột context manager) → `skipOpenTelemetrySetup: true` +
 * TẮT default integration (nhiều cái móc vào OTel/HTTP của Sentry). Chỉ giữ 2
 * integration cấp tiến trình (không phụ thuộc OTel). Tracing là việc của OTel
 * (docs/11 §4, exporter bật ở phase 2) — ở đây Sentry chỉ bắt LỖI
 * (`tracesSampleRate: 0`).
 *
 * Bật chỉ khi có `SENTRY_DSN` (dev/test/local không DSN → no-op hoàn toàn) → an
 * toàn cho mọi môi trường, kích hoạt bằng env lúc deploy.
 */
let enabled = false;

export function initSentry(env: Env): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    skipOpenTelemetrySetup: true,
    registerEsmLoaderHooks: false,
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
    ],
    tracesSampleRate: 0,
  });
  enabled = true;
}

export interface ErrorContext {
  requestId?: string;
  tenantId?: string;
  path?: string;
  level?: 'error' | 'warning';
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/**
 * Gửi lỗi lên Sentry kèm ngữ cảnh (request_id + tenant_id — docs/11 §3).
 * No-op nếu Sentry chưa bật (không DSN) → gọi tự do từ filter/service.
 */
export function captureError(err: unknown, ctx: ErrorContext = {}): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (ctx.requestId) scope.setTag('request_id', ctx.requestId);
    if (ctx.tenantId) scope.setTag('tenant_id', ctx.tenantId);
    if (ctx.path) scope.setTag('path', ctx.path);
    if (ctx.level) scope.setLevel(ctx.level);
    for (const [key, value] of Object.entries(ctx.tags ?? {})) scope.setTag(key, value);
    if (ctx.extra) scope.setExtras(ctx.extra);
    Sentry.captureException(err);
  });
}

/** Flush event tồn trước khi tắt (gọi trong shutdown hook). */
export async function flushSentry(): Promise<void> {
  if (!enabled) return;
  await Sentry.close(2000);
}

export function isSentryEnabled(): boolean {
  return enabled;
}
