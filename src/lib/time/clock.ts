// ENGINEERING-24 — deterministic clock seam. Server code that needs "now" for a WRITTEN value
// (e.g. an outbox backoff `available_at`) depends on this interface instead of `new Date()` /
// `Date.now()`, so tests can inject a FakeClock and assert exact timestamps.
//
// NOT for: log timestamps (always real wall-clock — see src/lib/logger) and DB-computed times
// (Postgres `now()` / trigger timestamps). Timeliness scoring stays entirely in the DB (AD4).
export interface Clock {
  /** The current instant as a fresh Date (callers must never mutate a shared instance). */
  now(): Date;
}
