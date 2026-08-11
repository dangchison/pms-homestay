// Sentry client (browser) — error tracking (docs/11 §3).
// Chỉ bật khi có NEXT_PUBLIC_SENTRY_DSN (dev/local không DSN → no-op, build vẫn xanh).
//
// Trước đây file này tên `sentry.client.config.ts` ở gốc app, vốn chỉ được NẠP qua
// webpack plugin của withSentryConfig — chạy `next dev --turbopack` là Sentry phía
// trình duyệt tắt im lặng. `src/instrumentation-client.ts` được Next 15.3+ nạp
// native cho CẢ webpack lẫn Turbopack, nên hành vi giống nhau ở mọi bundler.
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

/** Next gọi hook này khi bắt đầu chuyển route ở client — Sentry gắn vào để đo. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
