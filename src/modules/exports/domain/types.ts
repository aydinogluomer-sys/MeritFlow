export type PayoutExportFormat = 'csv' | 'xlsx';

export interface ExportPayoutInput {
  periodId: string;
  snapshotId: string;
  format: PayoutExportFormat;
}

export interface MarkPaidInput {
  periodId: string;
  exportId: string;
}

export interface ExportsContext {
  organizationId: string;
  userId: string;
}
