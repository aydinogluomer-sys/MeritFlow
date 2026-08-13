import next from 'eslint-config-next';

// eslint-config-next 16 ships a native ESLint flat-config array (core-web-vitals +
// typescript). No FlatCompat needed.
const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  ...next,
  {
    rules: {
      // Two import boundaries, both ERRORS:
      //  (1) AD1 / SI-11 — the service-role admin client is server-only. Hard guards are
      //      `import 'server-only'` in src/lib/supabase/admin.ts + security-boundary test #4.
      //      This flags any OTHER import of it; the only legitimate importers (server actions,
      //      unit tests) are exempted in the override below.
      //  (2) ENGINEERING-02A module boundary — a domain module is consumed only through its
      //      public `@/modules/<domain>` index, never a deep internal path. Dependency
      //      direction (guide for 02B+): app → modules/<domain> (index) → lib; modules must
      //      not import app/*, and must not deep-import a sibling domain's internals.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/supabase/admin', '**/supabase/admin'],
              message:
                'admin (service_role) client is server-only. Import it only inside trusted server modules (server actions); never from client components.',
            },
            {
              group: ['@/modules/*/*', '@/modules/*/**'],
              message:
                'Import a domain module only via its public index (@/modules/<domain>), never a deep internal path (ENGINEERING-02A boundary).',
            },
          ],
        },
      ],
    },
  },
  {
    // Server actions legitimately import the admin client for RPC; unit tests mock/import it.
    // Both are server-only contexts (not client components) — drop the admin restriction here.
    // The module-boundary restriction (2) still applies.
    files: ['src/app/actions/**', 'tests/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/*', '@/modules/*/**'],
              message:
                'Import a domain module only via its public index (@/modules/<domain>), never a deep internal path (ENGINEERING-02A boundary).',
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
