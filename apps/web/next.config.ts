import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// The shared .env lives at the repository root (see .env.example); Next only reads
// apps/web by default and caches that result, hence forceReload. `next dev` and
// `next build` run from apps/web.
loadEnvConfig(path.resolve(process.cwd(), '../..'), process.env.NODE_ENV !== 'production', console, true);

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source; Next compiles them.
  transpilePackages: ['@llms-txt/contracts', '@llms-txt/db'],
  // Stop `next dev` from writing apps/web/AGENTS.md when it detects a coding agent.
  agentRules: false,
};

export default nextConfig;
