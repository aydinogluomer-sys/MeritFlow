// Phase P0 — MetricResult DTO (plan §2.1). The shape every metric computation returns, so a value
// always travels with its unit, period, tenant, dimensions and source version — never a bare number.
// Contract only; the deterministic producers land per-module later.
import { z } from 'zod';
import { MetricIdSchema, MetricUnitSchema } from './metric-id';

/** ISO-8601 date/datetime string guard (contract-level; producers stamp real timestamps). */
const IsoString = z.string().min(1);

export const MetricPeriodSchema = z.object({
  start: IsoString,
  end: IsoString,
});
export type MetricPeriod = z.infer<typeof MetricPeriodSchema>;

export const MetricResultSchema = z.object({
  metricId: MetricIdSchema,
  value: z.union([z.number(), z.string()]),
  unit: MetricUnitSchema,
  period: MetricPeriodSchema,
  organizationId: z.string().uuid(),
  // Realized dimension slice for this result (e.g. { team: '<uuid>' }); keys are DimensionId values.
  dimensions: z.record(z.string(), z.string()),
  computedAt: IsoString,
  // Version of the deterministic rule/policy set that produced the value (reproducibility, §1 pt.9).
  sourceVersion: z.string().min(1),
});

export type MetricResult = z.infer<typeof MetricResultSchema>;
