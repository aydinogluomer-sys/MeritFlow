// Phase P0 — Insight status lifecycle (plan §2.8). The common feature lifecycle, adapted for the
// shared insight store: DRAFT → CALCULATED → REVIEWED → ACCEPTED|DISMISSED → APPLIED → OBSERVED →
// RETROSPECTIVE. DISMISSED and RETROSPECTIVE are terminal. Transitions are enforced in TypeScript
// (the repository) since insight writes are server-only; the DB additionally constrains status to
// this closed value set. Deterministic — no LLM decides a transition.
import { z } from 'zod';

export const INSIGHT_STATUSES = [
  'draft',
  'calculated',
  'reviewed',
  'accepted',
  'dismissed',
  'applied',
  'observed',
  'retrospective',
] as const;
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];
export const InsightStatusSchema = z.enum(INSIGHT_STATUSES);

/** Allowed forward transitions (plan §2.8). Empty array ⇒ terminal state. */
const TRANSITIONS: Record<InsightStatus, readonly InsightStatus[]> = {
  draft: ['calculated'],
  calculated: ['reviewed'],
  reviewed: ['accepted', 'dismissed'],
  accepted: ['applied'],
  dismissed: [],
  applied: ['observed'],
  observed: ['retrospective'],
  retrospective: [],
};

export function nextStatuses(from: InsightStatus): readonly InsightStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: InsightStatus, to: InsightStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: InsightStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Throw on an illegal transition — the sanctioned guard before a server-only status write. */
export function assertTransition(from: InsightStatus, to: InsightStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal insight status transition: ${from} -> ${to}`);
  }
}
