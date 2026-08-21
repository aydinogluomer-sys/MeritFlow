import type { Clock } from './clock';

/** The production Clock — real wall-clock time. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Shared singleton; the default clock for repositories (backward-compatible injection). */
export const systemClock: Clock = new SystemClock();
