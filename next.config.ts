import path from 'path';
import { fileURLToPath } from 'url';
import type { NextConfig } from 'next';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to THIS project. A stray parent lockfile
  // (C:\Users\Trade Bilisim\package-lock.json) otherwise makes Next infer the wrong
  // root. Setting both silences the "inferred your workspace root" warning.
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
};

// Decision C: Sentry is scaffolded (env vars, gate, and the server instrumentation
// hook in instrumentation.ts) but the build is NOT wrapped with withSentryConfig yet.
// The @sentry/nextjs SDK does not currently support Next.js 16 (its peer range caps at
// Next 15), so it is intentionally not installed. To enable later: install a
// Next-16-compatible @sentry/nextjs, set SENTRY_DSN, and wrap this export with
// withSentryConfig({ silent: true, telemetry: false }).
export default nextConfig;
