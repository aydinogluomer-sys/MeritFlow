import { z } from 'zod';

export const RunCalculationSchema = z.object({
  periodId: z.string().uuid(),
  poolId: z.string().uuid(),
});

export const PostAccrualSchema = z.object({
  periodId: z.string().uuid(),
});

export const RecalculateSchema = z.object({
  periodId: z.string().uuid(),
});

export const RunScanSchema = z.object({
  periodId: z.string().uuid().optional(),
});
