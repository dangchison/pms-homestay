import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pms/ui'],
  output: 'standalone',
  // TODO(task 6.6): wire Workbox service worker (precache shell + runtime cache GET)
};

export default nextConfig;
