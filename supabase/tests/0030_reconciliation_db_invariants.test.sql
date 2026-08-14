-- =============================================================================
-- pgTAP — ENGINEERING-06 Track D: DB-layer invariants behind the TS reconciliation
-- verifier (ENGINEERING-05 / src/modules/reconciliation).
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 0013/0014/0021/0022; Decision Lock D1 (SI-13), D6/BL (double-entry).
--
-- Complements the Vitest Track A (which exercises the TS aggregate logic on mock
-- rows) by proving, on a REAL engine run, the two DB facts the ReconciliationRepository
-- depends on but that the existing suites do NOT already assert:
--   (1) SI-13 holds against the EXACT column the repo reads —
--       calculation_metadata->>'pool_ref_minor' — not just the literal pool (0015 #2).
--   (2) the deferred balance trigger REJECTS an unbalanced transaction (0016 proves it
--       ACCEPTS a balanced batch + BL-2 over-accrual; it never asserts the Σdebit≠Σcredit
--       rejection that checkLedgerBalance mirrors).
-- Reuses the seeded Org C worked example (period 230 / pool 231, T=1), like 0015/0016.
-- =============================================================================
begin;
select no_plan();

-- Run the 0021 engine on the seeded locked worked example → allocations + snapshot.
select public.run_bonus_calculation(
  'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000230',
  'a0000000-0000-0000-0000-000000000231', 'recon-0030', 'c0000000-0000-0000-0000-0000000000c3');

-- (#1) INV-SI13 via the reconciliation data source. checkPoolSum compares
-- Σ(final_amount_minor) + undistributed_remainder_minor against
-- (calculation_metadata->>'pool_ref_minor')::bigint. Prove that difference is exactly 0
-- on real engine output (0015 #2 asserts SI-13 against the literal pool, not this column).
select is(
  (select coalesce(sum(a.final_amount_minor), 0) + s.undistributed_remainder_minor
          - (s.calculation_metadata->>'pool_ref_minor')::bigint
   from public.bonus_calculation_runs r
   join public.bonus_allocation_snapshots s
     on s.calculation_run_id = r.id and s.organization_id = r.organization_id
   left join public.bonus_allocations a
     on a.calculation_run_id = r.id and a.organization_id = r.organization_id
   where r.bonus_period_id = 'a0000000-0000-0000-0000-000000000230'
   group by s.undistributed_remainder_minor, s.calculation_metadata),
  0::bigint,
  'D1/SI-13: Σfinal + undistributed = calculation_metadata->>pool_ref_minor (reconciliation data source)');

-- (#2) The engine always populates pool_ref_minor — the reconciliation verifier skips
-- snapshots without it (NaN branch), so a missing value would silently drop SI-13 coverage.
select ok(
  (select (s.calculation_metadata ? 'pool_ref_minor')
          and (s.calculation_metadata->>'pool_ref_minor') is not null
   from public.bonus_allocation_snapshots s
   join public.bonus_calculation_runs r on r.id = s.calculation_run_id
   where r.bonus_period_id = 'a0000000-0000-0000-0000-000000000230'),
  'D1/SI-13: engine populates pool_ref_minor (every completed run is a reconciliation subject)');

-- Force the deferred double-entry balance trigger (0014) to check per-statement (0008/0016 pattern).
select lives_ok('set constraints all immediate', 'balance constraint set immediate');

-- (#3) INV-LEDGER-BALANCE at the DB layer: an unbalanced transaction (a pool debit with no
-- matching credit) is rejected by enforce_bonus_ledger_balance — the DB-side guarantee that
-- checkLedgerBalance re-verifies read-only. (The engine wrote no ledger rows, so this is the
-- only pending row for its fresh transaction_id → Σdebit 1000 ≠ Σcredit 0.)
select throws_ok(
  $$ insert into public.bonus_ledger
       (organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id,
        transaction_id, entry_type, account, event_type, amount_minor, created_by)
     select 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000231',
            null, r.id, s.id, gen_random_uuid(), 'debit', 'pool', 'bonus_accrual', 1000,
            'c0000000-0000-0000-0000-0000000000c4'
     from public.bonus_allocation_snapshots s
     join public.bonus_calculation_runs r on r.id = s.calculation_run_id
     where r.bonus_period_id = 'a0000000-0000-0000-0000-000000000230' and r.status = 'completed' $$,
  '23514', NULL,
  'BL-1/INV-LEDGER-BALANCE: an unbalanced bonus_ledger transaction (Σdebit != Σcredit) is rejected');

select * from finish();
rollback;
