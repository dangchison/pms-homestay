import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pms/ui'],
  output: 'standalone',
};

export default nextConfig;
