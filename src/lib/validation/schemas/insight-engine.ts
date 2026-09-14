import { z } from 'zod';

// Phase P4 (8-C3) — on-demand insight-engine trigger input. An optional bonus_period to run against;
// omitted → the engine runs for the org's current (newest) period. No other input (org comes from the
// server session, never the client).
export const RunInsightEngineSchema = z.object({
  bonusPeriodId: z.string().uuid().optional(),
});
export type RunInsightEngineInput = z.infer<typeof RunInsightEngineSchema>;
