// Point-ledger domain types (ENGINEERING-02C). The ledger is append-only and server-only
// (authenticated has NO INSERT — 0003 pgTAP). Writes go through the SECURITY DEFINER RPC via
// the admin client; the ledger is never mutated in place (reversal/adjustment entries only).

export interface ManualOverrideInput {
  employeeId: string;
  pointsDelta: number;
  reason: string;
  secondApproverId: string;
  taskId?: string;
}

export interface PointLedgerContext {
  organizationId: string;
  userId: string;
}

export const MANUAL_OVERRIDE_RPC = 'apply_manual_point_adjustment' as const;
