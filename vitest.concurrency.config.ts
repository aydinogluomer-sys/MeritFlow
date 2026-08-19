import { defineConfig } from 'vitest/config';

// ENGINEERING-16 — separate config for the real-DB concurrency harness. Node env (raw pg, no
// jsdom), long timeouts (DB ops + advisory-lock gate are slow), and a single fork so the race
// files run SERIALLY between each other (each file's concurrency is internal, via race()). Kept
// out of the main vitest config so `vitest run` never needs a live database.
export default defineConfig({
  test: {
    include: ['tests/concurrency/**/*.race.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 15_000,
    pool: 'forks',
    // vitest 4 dropped `poolOptions.forks.singleFork` from the config type; `fileParallelism: false`
    // is the v4 equivalent — race files run SERIALLY (each file's concurrency is internal, via race()).
    fileParallelism: false,
  },
});
