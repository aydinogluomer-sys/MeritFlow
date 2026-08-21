import { z } from 'zod';

// ENGINEERING-23 (§12) — Zod contract for the untyped jsonb `bonus_allocation_snapshots.
// calculation_metadata`. The generated DB types model it as `Json` (an opaque union), so any field
// access is unchecked. This schema validates the one field the reconciliation verifier reads
// (`pool_ref_minor`, SI-13) while letting other keys pass through (forward-compat).

export const BonusSnapshotMetadataSchema = z
  .object({
    pool_ref_minor: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough(); // extra keys survive — the engine may add metadata without breaking this read.

export type BonusSnapshotMetadata = z.infer<typeof BonusSnapshotMetadataSchema>;

/**
 * `pool_ref_minor` coerced to a number, or NaN when the metadata is absent / not an object / the
 * field is missing/blank/unparseable. NEVER throws — this is a read path, and NaN is the existing
 * "indeterminate" signal (the reconciliation verifier skips NaN, treating the snapshot as not an
 * SI-13 subject rather than raising a false mismatch).
 */
export function poolRefFromMetadata(metadata: unknown): number {
  const parsed = BonusSnapshotMetadataSchema.safeParse(metadata);
  if (!parsed.success) return NaN;
  const raw = parsed.data.pool_ref_minor;
  return raw == null || raw === '' ? NaN : Number(raw);
}
