import { describe, expect, it } from 'vitest';
import type { Database } from '@/types/database.generated';

// ENGINEERING-23 (§12) — COMPILE-TIME contract test. There is no runtime assertion of value here:
// the point is that these type references resolve. If the generated file is malformed, or a table /
// function the app depends on is renamed away, `npm run typecheck` fails and this "test" fails with it.
type Tables = Database['public']['Tables'];
type Functions = Database['public']['Functions'];

// Representative tables the app relies on must exist with a Row type.
const _bonusPeriodsRow = {} as Tables['bonus_periods']['Row'];
const _pointLedgerRow = {} as Tables['point_ledger']['Row'];
const _compRow = {} as Tables['compensation_records']['Row'];

// At least one RPC contract must resolve (Args/Returns).
const _runCalc = {} as Functions['run_bonus_calculation'];

describe('database.generated Database type contract', () => {
  it('resolves key Tables Row types + a Functions entry at compile time', () => {
    // Runtime no-op — reaching here means the type references above compiled.
    expect([_bonusPeriodsRow, _pointLedgerRow, _compRow, _runCalc]).toHaveLength(4);
  });
});
