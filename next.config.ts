import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  eslint: {
    dirs: ['src', 'e2e', 'scripts'],
  },
  // The dev-mode build-activity indicator renders bottom-left and intercepts pointer
  // events over BottomNav's first tab at mobile viewports (dev/e2e only — not present
  // in production builds either way).
  devIndicators: false,
};

export default nextConfig;
