import { z } from 'zod';

// Phase P1 / slice 6-C — action schemas for the Policy Change Impact UI. Create/note reuse the
// module's NewChangeRequestInputSchema / DecisionInputSchema; these add the id-only + simulation +
// decision shapes the server actions need. commandId is optional (correlation only).

export const ChangeRequestIdSchema = z.object({
  changeRequestId: z.string().uuid(),
  commandId: z.string().uuid().optional(),
});

export const DecideChangeRequestSchema = z.object({
  changeRequestId: z.string().uuid(),
  decision: z.enum(['reject', 'request_changes']),
  note: z.string().trim().min(1, 'a decision note is required').max(2000),
  commandId: z.string().uuid().optional(),
});

export const RunSimulationSchema = z.object({
  changeRequestId: z.string().uuid(),
  referencePeriodId: z.string().uuid(),
  commandId: z.string().uuid().optional(),
});

export type ChangeRequestIdInput = z.infer<typeof ChangeRequestIdSchema>;
export type DecideChangeRequestInput = z.infer<typeof DecideChangeRequestSchema>;
export type RunSimulationInput = z.infer<typeof RunSimulationSchema>;
