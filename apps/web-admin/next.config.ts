import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @pms/ui tiêu thụ từ source (docs/13 §7 — 1 bản shadcn duy nhất)
  transpilePackages: ['@pms/ui'],
  // Docker multi-stage (infra/docker/web.Dockerfile)
  output: 'standalone',
  // KHÔNG có app/api proxy — FE gọi thẳng API domain (SSE không proxy qua Next, docs/13 §3)
};

export default nextConfig;
