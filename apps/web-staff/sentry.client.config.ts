// Sentry client (browser) — error tracking (docs/11 §3).
// Chỉ bật khi có NEXT_PUBLIC_SENTRY_DSN (dev/local không DSN → no-op, build vẫn xanh).
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    tracesSampleRate: 0, // tracing = OTel/phase 2; ở đây chỉ bắt lỗi
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0, // chưa bật Session Replay (tránh ghi dữ liệu khách)
  });
}
