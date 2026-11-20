import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// The shared .env lives at the repository root (see .env.example); Next only reads
// apps/web by default. `next dev` and `next build` run from apps/web.
loadEnvConfig(path.resolve(process.cwd(), '../..'));

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source; Next compiles them.
  transpilePackages: ['@llms-txt/contracts', '@llms-txt/db'],
};

export default nextConfig;
