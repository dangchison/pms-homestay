import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @pms/ui tiêu thụ từ source (docs/13 §7 — 1 bản shadcn duy nhất)
  transpilePackages: ['@pms/ui'],
  // Docker multi-stage (infra/docker/web.Dockerfile)
  output: 'standalone',
  // KHÔNG có app/api proxy — FE gọi thẳng API domain (SSE không proxy qua Next, docs/13 §3)
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
