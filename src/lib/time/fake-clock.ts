import type { Clock } from './clock';

/**
 * A controllable Clock for tests. Time only moves when the test moves it (advance / setNow), so
 * backoff / timestamp logic is fully deterministic. `now()` returns a fresh copy each call.
 */
export class FakeClock implements Clock {
  private _now: Date;

  constructor(initial: Date | string = new Date('2024-01-15T10:00:00Z')) {
    this._now = new Date(initial instanceof Date ? initial.getTime() : initial);
  }

  now(): Date {
    return new Date(this._now);
  }

  /** Move the clock forward by `ms` milliseconds. */
  advance(ms: number): void {
    this._now = new Date(this._now.getTime() + ms);
  }

  /** Set the clock to an absolute instant. */
  setNow(date: Date): void {
    this._now = new Date(date);
  }
}
