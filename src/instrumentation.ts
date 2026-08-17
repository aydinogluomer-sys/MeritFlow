// Next resolves `instrumentation.ts` from the project root for a root-level `app/`, so the real
// server Sentry init lives there. This re-export keeps a single source of truth in case a build
// resolves the `src/` variant instead — either way the same `register` runs (Next loads exactly one).
export { register } from '../instrumentation';
