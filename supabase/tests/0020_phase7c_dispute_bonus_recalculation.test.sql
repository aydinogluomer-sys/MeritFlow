-- =============================================================================
-- pgTAP — Phase 7-C blocking suite: dispute bonus recalculation + reversal (C-c1)
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 07 §63, 19 §5.3, 0026 (the slice); Decision Lock D2/AD10; ADR-006/017.
--       recalculate_bonus_after_dispute(): MECHANICAL correction — reverse the accrual
--       (balanced), supersede the run, move period approved→calculated. No recompute.
--
-- Setup mirrors 0016: run the 0021 engine on the seeded locked Org C worked example
-- (period 230 / pool 231), approve the period, and post the accrual — then recalc.
-- The paid-guard scenario uses a second seeded locked period (272 / pool 273), accrues
-- it, and injects a payout row (a future producer is simulated by disabling the ledger's
-- event-type guard for the insert). All UUIDs are seed-deterministic.
-- =============================================================================
begin;
select no_plan();

-- helper: the accrued snapshot id for a period (Org C).
create function _b7c_snap(p_period uuid)
returns uuid language sql as $$
  select s.id
  from public.bonus_allocation_snapshots s
  join public.bonus_calculation_runs r
    on r.id = s.calculation_run_id and r.organization_id = s.organization_id
  where r.bonus_period_id = p_period and r.organization_id = 'c0000000-0000-0000-0000-000000000003'
  limit 1;
$$;

-- =============================================================================
-- SECTION A — worked example (period 230): approve + accrue, then recalc
-- =============================================================================
select public.run_bonus_calculation(
  'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000230',
  'a0000000-0000-0000-0000-000000000231', '7cwe', 'c0000000-0000-0000-0000-0000000000c3');
update public.bonus_periods set status = 'approved'
  where id = 'a0000000-0000-0000-0000-000000000230' and status = 'calculated';
select public.post_bonus_accrual(
  'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000230',
  'c0000000-0000-0000-0000-0000000000c3');

-- (#1) Function exists.
select has_function('public', 'recalculate_bonus_after_dispute', 'recalculate_bonus_after_dispute exists');

-- (#2) Positive: recalc an approved+accrued period.
select lives_ok(
  $$ select public.recalculate_bonus_after_dispute('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3') $$,
  'recalc succeeds on an approved+accrued period');

-- (#3) The reversal rows were written.
select ok(
  (select count(*) from public.bonus_ledger where snapshot_id = _b7c_snap('a0000000-0000-0000-0000-000000000230') and event_type = 'reversal') > 0,
  'reversal rows written for the accrued snapshot');

-- (#4) The reversal is balanced (Σdebit = Σcredit).
select is(
  (select coalesce(sum(amount_minor) filter (where entry_type = 'debit'), 0) from public.bonus_ledger where snapshot_id = _b7c_snap('a0000000-0000-0000-0000-000000000230') and event_type = 'reversal'),
  (select coalesce(sum(amount_minor) filter (where entry_type = 'credit'), 0) from public.bonus_ledger where snapshot_id = _b7c_snap('a0000000-0000-0000-0000-000000000230') and event_type = 'reversal'),
  'reversal transaction is balanced (Σdebit = Σcredit)');

-- (#5) The reversal magnitude equals the original accrual (mirror).
select is(
  (select coalesce(sum(amount_minor) filter (where entry_type = 'debit'), 0) from public.bonus_ledger where snapshot_id = _b7c_snap('a0000000-0000-0000-0000-000000000230') and event_type = 'reversal'),
  (select coalesce(sum(amount_minor) filter (where entry_type = 'credit'), 0) from public.bonus_ledger where snapshot_id = _b7c_snap('a0000000-0000-0000-0000-000000000230') and event_type = 'bonus_accrual'),
  'reversal debit total = original accrual credit total');

-- (#6) The old run is superseded.
select is(
  (select status from public.bonus_calculation_runs where bonus_period_id = 'a0000000-0000-0000-0000-000000000230' and organization_id = 'c0000000-0000-0000-0000-000000000003' limit 1),
  'superseded', 'old completed run is superseded');

-- (#7) The period moved approved -> calculated (re-approval required).
select is(
  (select status from public.bonus_periods where id = 'a0000000-0000-0000-0000-000000000230'),
  'calculated', 'period moved approved -> calculated');

-- (#8) Old snapshot is immutable (ADR-006): UPDATE -> 23001.
select throws_ok(
  $$ update public.bonus_allocation_snapshots set undistributed_remainder_minor = 0 where id = _b7c_snap('a0000000-0000-0000-0000-000000000230') $$,
  '23001', NULL, 'old snapshot is immutable (UPDATE -> 23001, ADR-006)');

-- (#9) Re-approval required: re-accrual is blocked while the period is 'calculated'.
select throws_ok(
  $$ select public.post_bonus_accrual('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'post_bonus_accrual blocked while period is calculated (re-approval required)');

-- (#10) Idempotency: a second recalc is a no-op (same snapshot, no duplicate reversal).
select is(
  (select public.recalculate_bonus_after_dispute('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3')),
  _b7c_snap('a0000000-0000-0000-0000-000000000230'),
  'second recalc returns the same snapshot (idempotent no-op)');
select is(
  (select count(*) from public.bonus_ledger where snapshot_id = _b7c_snap('a0000000-0000-0000-0000-000000000230') and event_type = 'reversal'),
  (select count(*) from public.bonus_ledger where snapshot_id = _b7c_snap('a0000000-0000-0000-0000-000000000230') and event_type = 'bonus_accrual'),
  'no duplicate reversal on re-call (one reversal row per accrual row)');
select is(
  (select status from public.bonus_periods where id = 'a0000000-0000-0000-0000-000000000230'),
  'calculated', 'period stays calculated on the idempotent re-call');

-- =============================================================================
-- SECTION B — paid-accrual guard (D2): a paid accrual cannot be reversed
-- A self-contained approved+accrued period built by direct inserts (no engine): a
-- locked period+pool, a completed run + snapshot, and a manual balanced accrual — then
-- a simulated payout row. (272 is not a seeded period; 0015 builds its scenarios inline.)
-- =============================================================================
insert into public.bonus_periods (id, organization_id, period_type, starts_on, ends_on, status, created_by)
  values ('c0000000-0000-0000-0000-0000000007c2', 'c0000000-0000-0000-0000-000000000003', 'monthly', date '2024-03-01', date '2024-03-31', 'open', 'c0000000-0000-0000-0000-0000000000c3');
insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by)
  values ('c0000000-0000-0000-0000-0000000007c3', 'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000007c2', 1000, 'TRY', 'draft', 'c0000000-0000-0000-0000-0000000000c3');
update public.bonus_pools set status = 'locked', t_org = 1, locked_at = now(), locked_by = 'c0000000-0000-0000-0000-0000000000c3'
  where id = 'c0000000-0000-0000-0000-0000000007c3';
update public.bonus_periods set status = 'locked', locked_at = now(), locked_by = 'c0000000-0000-0000-0000-0000000000c3'
  where id = 'c0000000-0000-0000-0000-0000000007c2';
insert into public.bonus_calculation_runs (id, organization_id, bonus_period_id, bonus_pool_id, status, idempotency_key, t_org, triggered_by)
  values ('c0000000-0000-0000-0000-0000000007c4', 'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000007c2', 'c0000000-0000-0000-0000-0000000007c3', 'running', '7c-manual', 1, 'c0000000-0000-0000-0000-0000000000c3');
update public.bonus_calculation_runs set status = 'completed', completed_at = now() where id = 'c0000000-0000-0000-0000-0000000007c4';
insert into public.bonus_allocation_snapshots (id, organization_id, calculation_run_id, bonus_period_id, bonus_pool_id, t_org, undistributed_remainder_minor, calculation_metadata)
  values ('c0000000-0000-0000-0000-0000000007c5', 'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000007c4', 'c0000000-0000-0000-0000-0000000007c2', 'c0000000-0000-0000-0000-0000000007c3', 1, 0, '{}'::jsonb);
update public.bonus_periods set status = 'calculated' where id = 'c0000000-0000-0000-0000-0000000007c2' and status = 'locked';
update public.bonus_periods set status = 'approved'   where id = 'c0000000-0000-0000-0000-0000000007c2' and status = 'calculated';
-- manual balanced accrual (pool debit = employee credit) for the snapshot.
insert into public.bonus_ledger
  (organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, transaction_id, entry_type, account, event_type, amount_minor, reason, created_by)
values
  ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000007c3', null, 'c0000000-0000-0000-0000-0000000007c4', 'c0000000-0000-0000-0000-0000000007c5', 'c0000000-0000-0000-0000-0000000007c6', 'debit',  'pool',    'bonus_accrual', 1000, 'manual accrual', 'c0000000-0000-0000-0000-0000000000c3'),
  ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000007c3', 'a0000000-0000-0000-0000-000000000201', 'c0000000-0000-0000-0000-0000000007c4', 'c0000000-0000-0000-0000-0000000007c5', 'c0000000-0000-0000-0000-0000000007c6', 'credit', 'accrual', 'bonus_accrual', 1000, 'manual accrual', 'c0000000-0000-0000-0000-0000000000c3');

-- Flush the deferred balance trigger (all groups so far are balanced) so the ALTER below
-- is not blocked by pending trigger events; from here constraints are IMMEDIATE.
set constraints all immediate;

-- Simulate a payout-in-progress marker for the accrued snapshot (payout_exported is not
-- writable via the event-type guard — disable it only for this balanced insert). NOTE:
-- payout_exported is used (not payout_marked_paid) so 0027's payout_export_chk — which
-- requires export_id on payout_marked_paid rows — does not apply to this bare fixture;
-- recalculate_bonus_after_dispute()'s paid-guard checks both payout_* events.
alter table public.bonus_ledger disable trigger trg_bonus_ledger_validate_event;
insert into public.bonus_ledger
  (organization_id, bonus_pool_id, employee_id, snapshot_id, transaction_id, entry_type, account, event_type, amount_minor, reason, created_by)
values
  ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000007c3', null, 'c0000000-0000-0000-0000-0000000007c5',
   'c0000000-0000-0000-0000-0000000007c1', 'debit',  'payout', 'payout_exported', 100, 'sim payout', 'c0000000-0000-0000-0000-0000000000c3'),
  ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000007c3', null, 'c0000000-0000-0000-0000-0000000007c5',
   'c0000000-0000-0000-0000-0000000007c1', 'credit', 'payout', 'payout_exported', 100, 'sim payout', 'c0000000-0000-0000-0000-0000000000c3');
alter table public.bonus_ledger enable trigger trg_bonus_ledger_validate_event;

-- (#11) paid-guard: recalc is rejected because the accrual is already paid (D2 clawback gated).
select throws_ok(
  $$ select public.recalculate_bonus_after_dispute('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000007c2','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'paid accrual cannot be reversed -> 23514 (clawback gated, D2)');

-- =============================================================================
-- SECTION C — authz + append-only
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000201"}', true);

-- (#12) An authenticated employee without period.manage is rejected 42501.
select throws_ok(
  $$ select public.recalculate_bonus_after_dispute('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3') $$,
  '42501', NULL, 'authenticated employee without period.manage -> 42501');

reset role;

-- (#13) Append-only: a reversal row cannot be mutated (ADR-005/SI-2).
select throws_ok(
  $$ update public.bonus_ledger set amount_minor = 1 where snapshot_id = _b7c_snap('a0000000-0000-0000-0000-000000000230') and event_type = 'reversal' $$,
  '23001', NULL, 'reversal row is append-only (UPDATE -> 23001)');

-- (#14) DB-level balance: every (org, transaction_id) group is balanced (accruals +
-- reversal + simulated payout pair) when the deferred trigger is forced.
select lives_ok('set constraints all immediate',
  'all bonus_ledger transactions balance (accrual + reversal + payout) — deferred trigger accepts');

select * from finish();
rollback;
