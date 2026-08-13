export interface RunScanInput {
  periodId?: string;
}

export interface AntiGamingContext {
  organizationId: string;
}

export const RUN_ANTI_GAMING_SCAN_RPC = 'run_anti_gaming_scan' as const;
