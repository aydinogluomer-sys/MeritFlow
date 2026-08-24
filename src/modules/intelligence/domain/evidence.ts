// Phase P0 — Evidence envelope (plan §2.3). Every insight must be traceable to evidence (§1 pt.5)
// and must carry an action path (§1 pt.6). These are the building blocks; the invariant that an
// Insight cannot exist WITHOUT evidence and WITHOUT an action lives in ./insight.ts.
import { z } from 'zod';

/** Kinds of deterministic source an insight can point back to (plan §2.3). */
export const EVIDENCE_SOURCE_TYPES = [
  'metric',
  'task',
  'review',
  'policy_version',
  'bonus_run',
  'snapshot',
  'ledger',
  'dispute',
  'exception',
  'external_work',
] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export const EvidenceRefSchema = z.object({
  sourceType: z.enum(EVIDENCE_SOURCE_TYPES),
  sourceId: z.string().min(1),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

/**
 * Where a suggested action routes the user (plan §12.8 "Every insight routes: Work Queue, Exception
 * Center, Digital Twin, policy review, dispute list, employee evidence"). `inspect` is the generic
 * drill-in.
 */
export const ACTION_ROUTES = [
  'inspect',
  'work_queue',
  'exception_center',
  'digital_twin',
  'policy_review',
  'dispute_list',
  'employee_evidence',
] as const;
export type ActionRoute = (typeof ACTION_ROUTES)[number];

export const SuggestedActionSchema = z.object({
  /** Stable action code (greppable, telemetry-friendly). */
  code: z.string().min(1),
  /** Human label (TR UI copy). */
  label: z.string().min(1),
  /** Optional routing destination (§12.8). */
  route: z.enum(ACTION_ROUTES).optional(),
  /** Optional concrete target the route acts on. */
  target: z.object({ type: z.string().min(1), id: z.string().min(1) }).optional(),
});
export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;
