// ENGINEERING-21 (§10) — mutation testing config. Measures the ASSERTION strength of the suite on
// the critical PURE-LOGIC files: does a wrong implementation actually get killed by a test?
// Scope is deliberately narrow (see mutate[]) — application/glue code is excluded (its survivors are
// mostly equivalent noise). Runs nightly (.github/workflows/nightly.yml), never in the per-PR CI.
/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: {
    // Reuse the app's Vitest config so the '@' + 'server-only' aliases and jsdom env carry over.
    configFile: 'vitest.config.ts',
  },
  mutate: [
    // Gated (mutation-baseline.json): SQLSTATE/PostgREST -> MeritFlowErrorCode mapping (branch-rich).
    'src/lib/errors/translate.ts',
    // Gated: Safe Pro-Rata + largest-remainder allocation (financial; D1/D6/D10/AD6/AD8).
    'src/modules/bonus-calculation/domain/allocation.ts',
    // Ungated extra coverage: CSV/jsonb field escaping (pure; exercised by the audit export test).
    'src/modules/audit/domain/csv.ts',
    // NOTE: reconciliation/domain/types.ts is intentionally OUT — it is a const severity map with no
    // branch logic; under ignoreStatic its mutants are not testable, so it would only add noise.
  ],
  reporters: ['html', 'json', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/report.html' },
  jsonReporter: { fileName: 'reports/mutation/report.json' },
  thresholds: {
    high: 90,
    low: 60,
    break: null, // Stryker never fails the run; scripts/check-mutation-score.js enforces the baseline.
  },
  timeoutMS: 60000,
  concurrency: 2,
  ignoreStatic: true, // static (run-once) mutants are not meaningfully testable — exclude them.
  coverageAnalysis: 'perTest',
  disableTypeChecks: true, // Stryker strips types before mutating; tsc runs as its own gate.
};
