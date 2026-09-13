import { z } from 'zod';

// Phase P3 / slice 2-B — action schema for resolving an opportunity_flag insight via the §2.8 status
// lifecycle. toStatus is a reviewer-driven step (calculated → reviewed → accepted|dismissed); the
// one-step legality is enforced server-side by IntelligenceRepository.transition/assertTransition. A
// resolution OUTCOME (accepted/dismissed) requires a non-empty reason (audited, §2.7).
export const ResolveOpportunityFlagSchema = z
  .object({
    insightId: z.string().uuid(),
    toStatus: z.enum(['calculated', 'reviewed', 'accepted', 'dismissed']),
    resolutionCode: z.string().trim().min(1).optional(),
  })
  .refine(
    (v) => !(v.toStatus === 'accepted' || v.toStatus === 'dismissed') || Boolean(v.resolutionCode),
    { message: 'Karar gerekçesi zorunludur', path: ['resolutionCode'] },
  );
export type ResolveOpportunityFlagInput = z.infer<typeof ResolveOpportunityFlagSchema>;
