import { z } from 'zod';

export const ExportPayoutSchema = z.object({
  periodId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  format: z.enum(['csv', 'xlsx']),
  commandId: z.string().uuid().optional(), // ENGINEERING-15: stable idempotency key (UI-supplied)
});

export const MarkPaidSchema = z.object({
  periodId: z.string().uuid(),
  exportId: z.string().uuid(),
  commandId: z.string().uuid().optional(), // ENGINEERING-15
});
