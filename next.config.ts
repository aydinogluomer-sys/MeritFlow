import path from 'path';
import { fileURLToPath } from 'url';
import type { NextConfig } from 'next';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// ENGINEERING-08: baseline security response headers applied to EVERY route.
// CSP is Report-Only for now — there is no golden-path E2E yet (deferred to ENGINEERING-11)
// to validate an enforcing policy at runtime, and an over-strict CSP would break the app
// silently (build/unit would stay green). The rollout to an enforcing CSP is documented in
// docs/runbooks/appsec.md. The 'unsafe-inline'/'unsafe-eval' allowances are placeholders to
// be tightened (nonce/hash) when the policy is enforced.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' https:",
].join('; ');

// Exported for the security-headers unit test (tests/unit/security-headers.test.ts).
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // No employee surveillance (CLAUDE.md): disable camera/microphone/geolocation + FLoC cohorts.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to THIS project. A stray parent lockfile
  // (C:\Users\Trade Bilisim\package-lock.json) otherwise makes Next infer the wrong
  // root. Setting both silences the "inferred your workspace root" warning.
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

// Decision C: Sentry is scaffolded (env vars, gate, and the server instrumentation
// hook in instrumentation.ts) but the build is NOT wrapped with withSentryConfig yet.
// The @sentry/nextjs SDK does not currently support Next.js 16 (its peer range caps at
// Next 15), so it is intentionally not installed. To enable later: install a
// Next-16-compatible @sentry/nextjs, set SENTRY_DSN, and wrap this export with
// withSentryConfig({ silent: true, telemetry: false }).
export default nextConfig;
