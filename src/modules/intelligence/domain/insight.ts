// Phase P0 — Insight domain type (plan §2.3). The evidence+action INVARIANT is enforced here: an
// Insight cannot be constructed without at least one EvidenceRef AND one SuggestedAction (anti-pattern
// §23 "insight without evidence or without action"). `deterministicFacts` is the authoritative,
// reproducible content; an LLM may only narrate FROM these facts (§2.3) — it never authors them, and
// P0 introduces no LLM at all.
import { z } from 'zod';
import { EvidenceRefSchema, SuggestedActionSchema } from './evidence';

/** Severity ladder for an insight (plan §2.3). */
export const INSIGHT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];
export const InsightSeveritySchema = z.enum(INSIGHT_SEVERITIES);

export const InsightSchema = z.object({
  id: z.string().uuid(),
  /** Insight type key (e.g. 'payout_concentration_spike'); free string, module-defined. */
  type: z.string().min(1),
  severity: InsightSeveritySchema,
  headline: z.string().min(1),
  /** Authoritative, reproducible facts (deterministic_payload). LLM narrates from these only. */
  deterministicFacts: z.record(z.string(), z.unknown()),
  /** INVARIANT: at least one evidence ref (§1 pt.5). */
  evidence: z.array(EvidenceRefSchema).min(1, 'an insight must carry at least one evidence ref'),
  /** INVARIANT: at least one action path (§1 pt.6). */
  suggestedActions: z
    .array(SuggestedActionSchema)
    .min(1, 'an insight must carry at least one suggested action'),
  generatedAt: z.string().min(1),
});

export type Insight = z.infer<typeof InsightSchema>;

/**
 * Parse+validate an untrusted insight, enforcing the evidence+action invariant. Throws (ZodError)
 * on violation — the ONLY sanctioned way to admit an Insight into the system.
 */
export function parseInsight(input: unknown): Insight {
  return InsightSchema.parse(input);
}
