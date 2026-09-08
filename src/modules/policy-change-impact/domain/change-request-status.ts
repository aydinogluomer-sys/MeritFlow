// Change-request lifecycle state machine (Module 6 / slice 6-A). PURE TS mirror of the DB trigger
// validate_policy_change_request() (migration 0043) — kept in lockstep so the app can guard a
// transition before hitting the DB. The DB remains the source of truth; this never widens what the
// DB allows. draft → submitted → approved | rejected | changes_requested; changes_requested → submitted.
import type { ChangeRequestStatus } from './types';

const ALLOWED_TRANSITIONS: Record<ChangeRequestStatus, readonly ChangeRequestStatus[]> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected', 'changes_requested'],
  changes_requested: ['submitted'],
  approved: [], // terminal
  rejected: [], // terminal
};

const TERMINAL: ReadonlySet<ChangeRequestStatus> = new Set(['approved', 'rejected']);

export function isTerminalStatus(status: ChangeRequestStatus): boolean {
  return TERMINAL.has(status);
}

export function canTransition(from: ChangeRequestStatus, to: ChangeRequestStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throw on an illegal transition (mirrors the DB's 23514). */
export function assertTransition(from: ChangeRequestStatus, to: ChangeRequestStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid policy change request transition: ${from} -> ${to}`);
  }
}
