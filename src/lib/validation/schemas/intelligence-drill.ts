import { z } from 'zod';
import { MetricIdSchema } from '@/modules/intelligence';

// Phase P4 (8-B1) — drill request schema (§10.10). A whitelisted metric + a drill level; the period
// defaults to the current relative window. The server action re-validates permission + runs the plan
// through buildDrillQuery/executeSemanticQuery (no raw SQL, §26).
export const DrillMetricSchema = z.object({
  metric: MetricIdSchema,
  level: z.enum(['company', 'team', 'employee']),
  bonusPeriodId: z.string().uuid().optional(),
});
export type DrillMetricInput = z.infer<typeof DrillMetricSchema>;
