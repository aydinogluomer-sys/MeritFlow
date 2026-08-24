// Phase P0 — SemanticQuery validator (plan §10.11 "Validate against permission + catalog"; hard gate
// §26 "no LLM raw SQL"). Deterministic, server-side: a proposed query is accepted ONLY when every
// metric is registered, the caller holds each metric's permission, and every requested/filtered
// dimension is catalog-approved for those metrics — with person-level dimensions requiring the
// elevated sensitive-dimension permission. This is the gate a later intent-parser output must pass
// before any deterministic query runs. Pure function — no IO, no LLM.
import { SemanticQuerySchema, type SemanticQuery } from './semantic-query';
import { metricRegistry, type MetricRegistry } from './registry';
import {
  SENSITIVE_DIMENSION_PERMISSION,
  isSensitiveDimension,
  type DimensionId,
} from '../dimensions/dimension-catalog';

export type ValidationErrorCode =
  | 'malformed_query'
  | 'unknown_metric'
  | 'metric_permission_denied'
  | 'dimension_not_allowed_for_metric'
  | 'sensitive_dimension_permission_denied';

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
}

export type ValidationResult =
  | { valid: true; query: SemanticQuery }
  | { valid: false; errors: ValidationError[] };

export interface ValidationContext {
  /** The caller's DB-sourced permissions (AD1 — never trusted from a JWT claim). */
  permissions: Iterable<string>;
  /** Registry to validate against; defaults to the approved P0 registry. */
  registry?: MetricRegistry;
}

/**
 * Validate a semantic query against the permission + dimension catalog. Returns every violation
 * (not just the first) so a caller/UI can surface all problems at once.
 */
export function validateSemanticQuery(input: unknown, ctx: ValidationContext): ValidationResult {
  const registry = ctx.registry ?? metricRegistry;
  const held = new Set(ctx.permissions);
  const errors: ValidationError[] = [];

  // 1) Structural shape — a malformed query cannot be reasoned about further.
  const parsed = SemanticQuerySchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: [{ code: 'malformed_query', message: parsed.error.issues.map((i) => i.message).join('; ') }],
    };
  }
  const query = parsed.data;

  // 2/3) Every metric must be registered and permitted.
  const knownMetrics = query.metrics.filter((id) => {
    if (!registry.has(id)) {
      errors.push({ code: 'unknown_metric', message: `metric not in registry: ${id}` });
      return false;
    }
    return true;
  });
  for (const id of knownMetrics) {
    const def = registry.get(id)!;
    if (!held.has(def.requiredPermission)) {
      errors.push({
        code: 'metric_permission_denied',
        message: `metric ${id} requires permission ${def.requiredPermission}`,
      });
    }
  }

  // 4) Every requested/filtered dimension must be allowed by EVERY known metric it applies to.
  const usedDimensions: DimensionId[] = [
    ...query.dimensions,
    ...query.filters.map((f) => f.dimension),
  ];
  for (const dim of usedDimensions) {
    for (const id of knownMetrics) {
      const def = registry.get(id)!;
      if (!def.allowedDimensions.includes(dim)) {
        errors.push({
          code: 'dimension_not_allowed_for_metric',
          message: `dimension ${dim} is not allowed for metric ${id}`,
        });
      }
    }
  }

  // 5) Person-level (sensitive) dimensions require the elevated permission.
  for (const dim of new Set(usedDimensions)) {
    if (isSensitiveDimension(dim) && !held.has(SENSITIVE_DIMENSION_PERMISSION)) {
      errors.push({
        code: 'sensitive_dimension_permission_denied',
        message: `sensitive dimension ${dim} requires permission ${SENSITIVE_DIMENSION_PERMISSION}`,
      });
    }
  }

  return errors.length === 0 ? { valid: true, query } : { valid: false, errors };
}
