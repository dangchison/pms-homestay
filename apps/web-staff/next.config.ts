import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pms/ui'],
  output: 'standalone',
  // PWA service worker = public/sw.js, đăng ký ở ServiceWorkerRegister (task 6.6).
};

// Sentry (docs/11 §3): upload source map khi CI có SENTRY_AUTH_TOKEN/ORG/PROJECT;
// thiếu token → chỉ bỏ qua upload (build vẫn xanh). Runtime no-op nếu không có DSN.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
