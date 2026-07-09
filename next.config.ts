import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  eslint: {
    dirs: ['src', 'e2e', 'scripts'],
  },
};

export default nextConfig;
