// Public API for the `audit` domain module (ENGINEERING-02A boundary).
// Consumers import only from `@/modules/audit` — never deep internal paths.
export { exportAudit } from './application/export-audit';
export { AuditRepository } from './repository/audit-repository';
export { CompAccessRepository } from './repository/comp-access-repository';
export type {
  ExportAuditInput,
  AuditExportContext,
  AuditExportRow,
  AuditExportResult,
} from './domain/types';
