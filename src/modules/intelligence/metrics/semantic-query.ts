// Phase P0 — SemanticQuery contract (plan §10.11). An intent parser (a later phase) proposes one of
// these; the server validates it against the permission + dimension catalog and ONLY THEN runs a
// deterministic query. An LLM never emits raw SQL (§10.11 / hard gate §26 "Intelligence: no LLM raw
// SQL"). P0 delivers the typed contract + Zod guard; the deterministic executor lands in P4.
import { z } from 'zod';
import { MetricIdSchema } from './metric-id';
import { DimensionIdSchema } from '../dimensions/dimension-catalog';

/** Filter operators a semantic query may use (closed set — no free-form SQL predicates). */
export const FILTER_OPERATORS = ['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte'] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const FilterSchema = z.object({
  dimension: DimensionIdSchema,
  operator: z.enum(FILTER_OPERATORS),
  // Scalar or list value; validation of value shape per-dimension is a later (executor) concern.
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
});
export type Filter = z.infer<typeof FilterSchema>;

/** Period selection — a named window or an explicit bounded range (bounded date range, §10.20). */
export const PeriodSelectorSchema = z.union([
  z.object({ kind: z.literal('bonus_period'), bonusPeriodId: z.string().uuid() }),
  z.object({ kind: z.literal('range'), start: z.string().min(1), end: z.string().min(1) }),
  z.object({
    kind: z.literal('relative'),
    trailing: z.enum(['current', 'previous', 'trailing_3', 'trailing_6']),
  }),
]);
export type PeriodSelector = z.infer<typeof PeriodSelectorSchema>;

/** Optional comparison basis for delta/"what changed?" reporting (§2.8, §10.2). */
export const ComparisonSchema = z.object({
  basis: z.enum(['previous_period', 'trailing_3', 'trailing_6', 'baseline']),
});
export type Comparison = z.infer<typeof ComparisonSchema>;

export const SemanticQuerySchema = z.object({
  metrics: z.array(MetricIdSchema).min(1),
  dimensions: z.array(DimensionIdSchema),
  filters: z.array(FilterSchema),
  period: PeriodSelectorSchema,
  comparison: ComparisonSchema.optional(),
});

export type SemanticQuery = z.infer<typeof SemanticQuerySchema>;
