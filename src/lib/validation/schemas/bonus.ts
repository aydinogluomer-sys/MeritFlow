import { z } from 'zod';

export const RunCalculationSchema = z.object({
  periodId: z.string().uuid(),
  poolId: z.string().uuid(),
});

/**
 * Create a bonus period. period_type is monthly-only in MVP (D11 / bonus_periods_type_chk);
 * startsOn/endsOn are ISO dates and the DB enforces ends_on > starts_on. status defaults to
 * 'open' in the DB (validate_bonus_period_transition requires INSERT status = open).
 */
export const CreatePeriodSchema = z.object({
  periodType: z.enum(['monthly']),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Create a bonus pool for a period. amountMinor is a non-negative integer in minor units
 * (bonus_pools_amount_pos_chk); currency is a 3-char code (bonus_pools_currency_chk).
 * status defaults to 'draft' in the DB.
 */
export const CreatePoolSchema = z.object({
  bonusPeriodId: z.string().uuid(),
  amountMinor: z.number().int().min(0),
  currency: z.string().length(3).default('TRY'),
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
