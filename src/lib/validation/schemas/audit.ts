import { z } from 'zod';

/**
 * Input for the audit CSV export action (Phase 10-A). Both bounds are optional
 * ISO-8601 datetimes; when present they filter `audit_logs.created_at`.
 */
export const ExportAuditSchema = z.object({
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});
