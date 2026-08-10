import { z } from 'zod';

export const ExportPayoutSchema = z.object({
  periodId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  format: z.enum(['csv', 'xlsx']),
});

export const MarkPaidSchema = z.object({
  periodId: z.string().uuid(),
  exportId: z.string().uuid(),
});
