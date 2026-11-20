import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source; Next compiles them.
  transpilePackages: ['@llms-txt/contracts', '@llms-txt/db'],
};

export default nextConfig;
