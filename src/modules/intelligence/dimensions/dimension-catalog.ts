// Phase P0 — Approved dimension catalog (plan §2.2). The CLOSED set of dimensions a semantic query
// may group/filter by. Sensitive dimensions (person-level) require an explicit elevated permission
// ("Sensitive dimensions explicit permission ister" — §2.2). No SQL here; this is a contract.
import { z } from 'zod';

/** The approved dimension ids (plan §2.2). */
export const DIMENSION_IDS = [
  'organization',
  'team',
  'policy_version',
  'bonus_period',
  'role',
  'employee',
  'manager',
  'task_type',
  'dispute_type',
  'exception_type',
  'cycle',
] as const;

export type DimensionId = (typeof DIMENSION_IDS)[number];

export const DimensionIdSchema = z.enum(DIMENSION_IDS);

/**
 * Person-level dimensions that expose an individual — grouping by them requires the elevated
 * `intelligence.manage` permission (§2.2 "sensitive dimensions explicit permission ister";
 * §17 data-privacy: person-identifying breakdown is not default-visible). Employees still reach
 * their OWN explainable data via RLS, not via this catalog.
 */
export const SENSITIVE_DIMENSIONS = new Set<DimensionId>(['employee', 'manager']);

/** Permission a query must hold to group/filter by a sensitive dimension. */
export const SENSITIVE_DIMENSION_PERMISSION = 'intelligence.manage' as const;

export function isSensitiveDimension(dimension: DimensionId): boolean {
  return SENSITIVE_DIMENSIONS.has(dimension);
}
