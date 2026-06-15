import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pms/ui'],
  output: 'standalone',
  // PWA service worker = public/sw.js, đăng ký ở ServiceWorkerRegister (task 6.6).
};

export default nextConfig;
