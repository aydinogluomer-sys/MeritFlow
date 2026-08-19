import { z } from 'zod';

export const ManualOverrideSchema = z.object({
  employeeId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  pointsDelta: z.number().int().refine((v) => v !== 0, 'points delta must be non-zero'),
  reason: z.string().min(1).max(1000),
  secondApproverId: z.string().uuid(),
  commandId: z.string().uuid().optional(), // ENGINEERING-15: append-only ledger → command_log dedup
});
