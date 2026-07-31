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
      // Guardrail (AD1 / SI-11): the service-role admin client is server-only.
      // The hard guard is `import 'server-only'` in src/lib/supabase/admin.ts;
      // this flags accidental imports of it from elsewhere as a reminder.
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['@/lib/supabase/admin', '**/supabase/admin'],
              message:
                'admin (service_role) client is server-only. Import it only inside trusted server modules; never from client components.',
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
