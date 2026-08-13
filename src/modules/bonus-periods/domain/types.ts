// Bonus-periods domain types (ENGINEERING-02D). Period/pool creation inputs. State machine
// (INSERT status=open / draft), audit triggers, and one-active-pool-per-period all live in the
// DB (0011) — never re-implemented here.

export type BonusPeriodType = 'monthly';

export interface CreatePeriodInput {
  periodType: BonusPeriodType;
  startsOn: string;
  endsOn: string;
}

export interface CreatePoolInput {
  bonusPeriodId: string;
  amountMinor: number;
  currency: string;
}

export interface BonusPeriodContext {
  organizationId: string;
  userId: string;
}
