// Zod contracts for policy-change-request inputs (Module 6 / slice 6-A). Server actions validate
// with these before touching the repository; the DB trigger (0043) re-enforces every rule.
import { z } from 'zod';

export const NewChangeRequestInputSchema = z
  .object({
    scoringPolicyId: z.string().uuid(),
    fromVersionId: z.string().uuid(),
    toDraftVersionId: z.string().uuid(),
    reason: z.string().trim().min(1, 'reason is required'),
    // Optional YYYY-MM-DD effective date; retroactive dates are gated by the DB (§8.11).
    effectiveDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveDate must be YYYY-MM-DD')
      .nullish(),
    allowRetroactive: z.boolean().default(false),
  })
  .refine((v) => v.fromVersionId !== v.toDraftVersionId, {
    message: 'from and to versions must differ',
    path: ['toDraftVersionId'],
  });

export type NewChangeRequestInput = z.infer<typeof NewChangeRequestInputSchema>;

export const DecisionInputSchema = z.object({
  note: z.string().trim().min(1, 'a decision note is required'),
});

export type DecisionInput = z.infer<typeof DecisionInputSchema>;
