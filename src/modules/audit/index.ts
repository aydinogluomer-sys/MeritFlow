// Public API for the `audit` domain module (ENGINEERING-02A boundary).
// Consumers import only from `@/modules/audit` — never deep internal paths.
export { exportAudit } from './application/export-audit';
export { AuditRepository } from './repository/audit-repository';
export { CompAccessRepository } from './repository/comp-access-repository';
// Pure CSV/jsonb serialization helpers (the audit export output contract).
export { csvField, jsonbField, AUDIT_CSV_HEADER } from './domain/csv';
export type {
  ExportAuditInput,
  AuditExportContext,
  AuditExportRow,
  AuditExportResult,
} from './domain/types';
