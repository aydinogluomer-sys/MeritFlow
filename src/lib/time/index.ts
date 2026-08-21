// Public API for the deterministic time seam (ENGINEERING-24).
export type { Clock } from './clock';
export { SystemClock, systemClock } from './system-clock';
export { FakeClock } from './fake-clock';
export {
  isInPeriod,
  PERIOD_BOUNDARY_SEMANTICS,
  type PeriodBoundary,
} from './period-boundary';
