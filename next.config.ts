import path from 'path';
import { fileURLToPath } from 'url';
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

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
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
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

// Sentry: @sentry/nextjs 10.x supports Next 16, so the build is wrapped (supersedes the earlier
// Decision-C deferral). `silent: true` suppresses build-time SDK logs; no org/project/authToken is
// set, so source maps are NOT uploaded (upload is opt-in). SENTRY_DSN is server-only (SI-11); the
// init lives in instrumentation.ts. (`hideSourceMaps` was dropped — it is not a valid option key in
// v10; Next does not emit browser source maps in production by default anyway.)
export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: 'omer-aydinoglu',

  project: 'meritflow',

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: '/monitoring',

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
