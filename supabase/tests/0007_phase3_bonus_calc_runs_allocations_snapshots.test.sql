-- =============================================================================
-- pgTAP — Phase 3 blocking suite: bonus_calculation_runs + bonus_allocations +
--         bonus_allocation_snapshots foundation
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 14/15 (bonus_* §), 16 (§4 run machine, §5 allocation machine,
--       SI-4/SI-6/SI-7/SI-12/SI-13/SI-14), ADR-006/017/018, D1/D6/AD6/AD7/AD9/AD10.
--
-- Section A = privileged (bypassrls); Section B = RLS as authenticated. All three
-- tables are server-only writes (SELECT-only for authenticated). Runs: state machine
-- running/completed/superseded + AD10 locked-period guard + idempotency. Allocations:
-- cap-not-exceeded, deferred approved/exported/paid, AD9 team, same-org employee,
-- frozen once run completed. Snapshots: thin, immutable (append-only), one per run.
--
-- Seed fixtures: locked period 30 + locked pool 31 (100k) + COMPLETED run 32 +
-- allocations 33 (a7/f1, 60k) / 34 (a8/f2, 40k) + snapshot 35 (remainder 0).
-- Org B mirror: 30/31/32/33/35. Also relies on OPEN period fa / DRAFT pool fb.
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls)
-- =============================================================================

-- (#1) Tables exist.
select has_table('public', 'bonus_calculation_runs',      'bonus_calculation_runs table exists');
select has_table('public', 'bonus_allocations',           'bonus_allocations table exists');
select has_table('public', 'bonus_allocation_snapshots',  'bonus_allocation_snapshots table exists');

-- (#2) RLS ENABLED + FORCE on all three.
select is(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('public.bonus_calculation_runs'::regclass,
                  'public.bonus_allocations'::regclass,
                  'public.bonus_allocation_snapshots'::regclass)),
  true, 'RLS ENABLED + FORCE on all three (SI-6)');

-- (#3) Privileges: SELECT-only for authenticated (server-only writes).
select is(has_table_privilege('authenticated', 'public.bonus_calculation_runs', 'SELECT'), true,  'runs SELECT');
select is(has_table_privilege('authenticated', 'public.bonus_calculation_runs', 'INSERT'), false, 'runs no INSERT (server-only)');
select is(has_table_privilege('authenticated', 'public.bonus_calculation_runs', 'DELETE'), false, 'runs no DELETE');
select is(has_table_privilege('authenticated', 'public.bonus_allocations', 'SELECT'), true,  'allocations SELECT');
select is(has_table_privilege('authenticated', 'public.bonus_allocations', 'INSERT'), false, 'allocations no INSERT (server-only)');
select is(has_table_privilege('authenticated', 'public.bonus_allocations', 'DELETE'), false, 'allocations no DELETE');
select is(has_table_privilege('authenticated', 'public.bonus_allocation_snapshots', 'SELECT'), true,  'snapshots SELECT');
select is(has_table_privilege('authenticated', 'public.bonus_allocation_snapshots', 'INSERT'), false, 'snapshots no INSERT (server-only)');
select is(has_table_privilege('authenticated', 'public.bonus_allocation_snapshots', 'UPDATE'), false, 'snapshots no UPDATE (append-only)');
select is(has_table_privilege('authenticated', 'public.bonus_allocation_snapshots', 'DELETE'), false, 'snapshots no DELETE (append-only)');

-- ---- Throwaway locked period 40 + pool 41 + RUNNING run 42 (isolation) --------
insert into public.bonus_periods (id, organization_id, starts_on, ends_on, created_by)
  values ('a0000000-0000-0000-0000-000000000040','a0000000-0000-0000-0000-000000000001',date '2026-04-01',date '2026-04-30','a0000000-0000-0000-0000-0000000000a3');
insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, created_by)
  values ('a0000000-0000-0000-0000-000000000041','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000040',3000000,'a0000000-0000-0000-0000-0000000000a4');
update public.bonus_pools set status='locked', t_org=1, locked_at=now(), locked_by='a0000000-0000-0000-0000-0000000000a4'
  where id='a0000000-0000-0000-0000-000000000041';
update public.bonus_periods set status='locked', locked_at=now(), locked_by='a0000000-0000-0000-0000-0000000000a3'
  where id='a0000000-0000-0000-0000-000000000040';
insert into public.bonus_calculation_runs
  (id, organization_id, bonus_period_id, bonus_pool_id, policy_version_id, idempotency_key, t_org, triggered_by)
  values ('a0000000-0000-0000-0000-000000000042','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000040','a0000000-0000-0000-0000-000000000041','a0000000-0000-0000-0000-0000000000d2','test-run-a-42',1,'a0000000-0000-0000-0000-0000000000a3');

-- (#4) Run state-machine + idempotency negatives.
select throws_ok(
  $$ insert into public.bonus_calculation_runs (organization_id, bonus_period_id, bonus_pool_id, status, idempotency_key, triggered_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030','a0000000-0000-0000-0000-000000000031','completed','test-must-run','a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'bonus_calculation_run must start in status running (got completed)',
  'run must start running (state machine INSERT guard)');
-- run cannot start on an OPEN period (fa) — AD10.
select throws_ok(
  $$ insert into public.bonus_calculation_runs (organization_id, bonus_period_id, bonus_pool_id, idempotency_key, triggered_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000fa','a0000000-0000-0000-0000-0000000000fb','test-open-period','a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'bonus_calculation_run requires a locked bonus_period (AD10; period status is open)',
  'run rejected on a non-locked (open) period (AD10)');
-- run cannot start on a DRAFT/non-locked pool even if the period is locked (AD10) —
-- period 30 is locked, but pool fb (org A) is draft.
select throws_ok(
  $$ insert into public.bonus_calculation_runs (organization_id, bonus_period_id, bonus_pool_id, idempotency_key, triggered_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030','a0000000-0000-0000-0000-0000000000fb','test-draft-pool','a0000000-0000-0000-0000-0000000000a3') $$,
  '23514',
  'bonus_calculation_run requires a locked bonus_pool (AD10; pool status is draft)',
  'run rejected on a non-locked (draft) pool (AD10)');
-- idempotency: same (org, idempotency_key) as seed run 32.
select throws_ok(
  $$ insert into public.bonus_calculation_runs (organization_id, bonus_period_id, bonus_pool_id, idempotency_key, triggered_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030','a0000000-0000-0000-0000-000000000031','seed-run-a-2026-05','a0000000-0000-0000-0000-0000000000a3') $$,
  '23505',
  'duplicate key value violates unique constraint "bonus_calculation_runs_idem_uq"',
  'duplicate (org, idempotency_key) run rejected (idempotency)');
-- forbidden transition completed -> running (seed run 32 is completed).
select throws_ok(
  $$ update public.bonus_calculation_runs set status='running' where id='a0000000-0000-0000-0000-000000000032' $$,
  '23514',
  'invalid bonus_calculation_run transition: completed -> running',
  'run completed -> running rejected');

-- (#5) Run cross-org composite FK negatives (SI-7).
select throws_ok(
  $$ insert into public.bonus_calculation_runs (organization_id, bonus_period_id, bonus_pool_id, idempotency_key, triggered_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030','b0000000-0000-0000-0000-000000000031','x-pool','a0000000-0000-0000-0000-0000000000a3') $$,
  '23503',
  'insert or update on table "bonus_calculation_runs" violates foreign key constraint "bonus_calculation_runs_pool_org_fk"',
  'cross-org run vs pool rejected by composite FK (SI-7)');
select throws_ok(
  $$ insert into public.bonus_calculation_runs (organization_id, bonus_period_id, bonus_pool_id, idempotency_key, triggered_by)
     values ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000030','b0000000-0000-0000-0000-000000000031','x-period','b0000000-0000-0000-0000-0000000000b1') $$,
  '23503',
  'insert or update on table "bonus_calculation_runs" violates foreign key constraint "bonus_calculation_runs_period_org_fk"',
  'cross-org run vs period rejected by composite FK (SI-7)');

-- (#6) Allocation constraint negatives (against RUNNING run 42).
select throws_ok(
  $$ insert into public.bonus_allocations (organization_id, calculation_run_id, bonus_period_id, employee_id, adjusted_score, raw_share_minor, final_amount_minor, cap_applied, cap_minor, status)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000042','a0000000-0000-0000-0000-000000000040','a0000000-0000-0000-0000-0000000000a7',10,200,200,'yes',100,'calculated') $$,
  '23514',
  'new row for relation "bonus_allocations" violates check constraint "bonus_allocations_cap_not_exceeded_chk"',
  'final_amount over cap rejected (INV-4)');
select throws_ok(
  $$ insert into public.bonus_allocations (organization_id, calculation_run_id, bonus_period_id, employee_id, adjusted_score, raw_share_minor, final_amount_minor, status)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000042','a0000000-0000-0000-0000-000000000040','a0000000-0000-0000-0000-0000000000a7',10,0,-1,'calculated') $$,
  '23514',
  'new row for relation "bonus_allocations" violates check constraint "bonus_allocations_amounts_nonneg_chk"',
  'negative final_amount rejected');
select throws_ok(
  $$ insert into public.bonus_allocations (organization_id, calculation_run_id, bonus_period_id, employee_id, adjusted_score, raw_share_minor, final_amount_minor, cap_applied, status)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000042','a0000000-0000-0000-0000-000000000040','a0000000-0000-0000-0000-0000000000a7',10,0,0,'no','pending_missing_cap_basis') $$,
  '23514',
  'new row for relation "bonus_allocations" violates check constraint "bonus_allocations_pending_mirror_chk"',
  'pending_missing_cap_basis status requires pending cap marker (AD6)');
select throws_ok(
  $$ insert into public.bonus_allocations (organization_id, calculation_run_id, bonus_period_id, employee_id, adjusted_score, raw_share_minor, final_amount_minor, status)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000042','a0000000-0000-0000-0000-000000000040','a0000000-0000-0000-0000-0000000000a7',10,0,0,'approved') $$,
  '23514',
  'bonus_allocations status approved (approval/export/payout) is deferred to a later phase — not writable in this slice',
  'approved/exported/paid status deferred (decision 3)');
-- AD9: a7 primary is f1, not f2.
select throws_ok(
  $$ insert into public.bonus_allocations (organization_id, calculation_run_id, bonus_period_id, employee_id, primary_team_id, adjusted_score, raw_share_minor, final_amount_minor, status)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000042','a0000000-0000-0000-0000-000000000040','a0000000-0000-0000-0000-0000000000a7','a0000000-0000-0000-0000-0000000000f2',10,0,0,'calculated') $$,
  '23514',
  'primary_team_id must be the employee primary team (team_memberships.is_primary; AD9)',
  'non-primary team_id rejected (AD9)');
-- cross-org employee: org A allocation with org B employee b2.
select throws_ok(
  $$ insert into public.bonus_allocations (organization_id, calculation_run_id, bonus_period_id, employee_id, adjusted_score, raw_share_minor, final_amount_minor, status)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000042','a0000000-0000-0000-0000-000000000040','b0000000-0000-0000-0000-0000000000b2',10,0,0,'calculated') $$,
  '23503',
  'insert or update on table "bonus_allocations" violates foreign key constraint "bonus_allocations_employee_org_fk"',
  'cross-org employee allocation rejected (SI-7)');

-- (#7) Allocation positive + duplicate (run,employee).
select lives_ok(
  $$ insert into public.bonus_allocations (id, organization_id, calculation_run_id, bonus_period_id, employee_id, primary_team_id, adjusted_score, raw_share_minor, final_amount_minor, cap_applied, status)
     values ('a0000000-0000-0000-0000-000000000043','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000042','a0000000-0000-0000-0000-000000000040','a0000000-0000-0000-0000-0000000000a7','a0000000-0000-0000-0000-0000000000f1',1000,1000,1000,'no','calculated') $$,
  'valid allocation (a7/f1) on a running run succeeds');
select throws_ok(
  $$ insert into public.bonus_allocations (organization_id, calculation_run_id, bonus_period_id, employee_id, adjusted_score, raw_share_minor, final_amount_minor, status)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000042','a0000000-0000-0000-0000-000000000040','a0000000-0000-0000-0000-0000000000a7',10,10,10,'calculated') $$,
  '23505',
  'duplicate key value violates unique constraint "bonus_allocations_run_emp_uq"',
  'duplicate (run, employee) allocation rejected');

-- (#8) Freeze once run completed (SI-4/SI-14).
select lives_ok(
  $$ update public.bonus_calculation_runs set status='completed', completed_at=now() where id='a0000000-0000-0000-0000-000000000042' $$,
  'run 42 running -> completed (setup for freeze)');
select throws_ok(
  $$ update public.bonus_allocations set adjusted_score=999 where id='a0000000-0000-0000-0000-000000000043' $$,
  '23001',
  'bonus_allocations is immutable once its calculation_run is not running (completed/superseded — new run required; SI-4/SI-14)',
  'allocation UPDATE rejected once run completed (freeze)');
select throws_ok(
  $$ insert into public.bonus_allocations (organization_id, calculation_run_id, bonus_period_id, employee_id, adjusted_score, raw_share_minor, final_amount_minor, status)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000042','a0000000-0000-0000-0000-000000000040','a0000000-0000-0000-0000-0000000000a8',10,10,10,'calculated') $$,
  '23001',
  'bonus_allocations is immutable once its calculation_run is not running (completed/superseded — new run required; SI-4/SI-14)',
  'allocation INSERT rejected into a completed run (freeze)');
-- completed -> superseded is allowed (new run path).
select lives_ok(
  $$ update public.bonus_calculation_runs set status='superseded', superseded_by=null where id='a0000000-0000-0000-0000-000000000042' $$,
  'run 42 completed -> superseded allowed');

-- (#9) Snapshot: one per run + immutable (append-only).
select throws_ok(
  $$ insert into public.bonus_allocation_snapshots (organization_id, calculation_run_id, bonus_period_id, bonus_pool_id, policy_version_id, t_org)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000032','a0000000-0000-0000-0000-000000000030','a0000000-0000-0000-0000-000000000031','a0000000-0000-0000-0000-0000000000d2',1) $$,
  '23505',
  'duplicate key value violates unique constraint "bonus_allocation_snapshots_run_uq"',
  'second snapshot per run rejected (one snapshot per run)');
select throws_ok(
  $$ update public.bonus_allocation_snapshots set undistributed_remainder_minor=1 where id='a0000000-0000-0000-0000-000000000035' $$,
  '23001',
  'append-only: UPDATE of immutable calculation fields on bonus_allocation_snapshots is not permitted',
  'snapshot UPDATE rejected (immutable — INV-6/SI-14)');
select throws_ok(
  $$ delete from public.bonus_allocation_snapshots where id='a0000000-0000-0000-0000-000000000035' $$,
  '23001',
  'append-only: DELETE on bonus_allocation_snapshots is not permitted',
  'snapshot DELETE rejected (immutable — INV-6/SI-14)');

-- (#10) DELETE blocked on runs + allocations (retention).
select throws_ok(
  $$ delete from public.bonus_calculation_runs where id='a0000000-0000-0000-0000-000000000032' $$,
  '23001',
  'delete forbidden: bonus_calculation_runs is retained (supersede only; deletion is a legal-review item)',
  'DELETE on bonus_calculation_runs blocked (retention)');
select throws_ok(
  $$ delete from public.bonus_allocations where id='a0000000-0000-0000-0000-000000000033' $$,
  '23001',
  'delete forbidden: bonus_allocations is retained (supersede only; deletion is a legal-review item)',
  'DELETE on bonus_allocations blocked (retention)');

-- (#11) Σ(final) + undistributed_remainder = pool (SI-13/INV-4) — seed-verified.
select is(
  (select coalesce(sum(final_amount_minor),0) from public.bonus_allocations
     where calculation_run_id='a0000000-0000-0000-0000-000000000032')::bigint
  + (select undistributed_remainder_minor from public.bonus_allocation_snapshots
     where calculation_run_id='a0000000-0000-0000-0000-000000000032'),
  (select amount_minor from public.bonus_pools where id='a0000000-0000-0000-0000-000000000031'),
  'Σ(final) + undistributed_remainder = pool (SI-13/INV-4) for seed run');

-- (#12) Audit rows from seed inserts.
select ok(exists (select 1 from public.audit_logs
                    where target_id='a0000000-0000-0000-0000-000000000032' and action='bonus_calculation_runs.insert'),
  'calculation run insert produced an audit row (calculation.run)');
select ok(exists (select 1 from public.audit_logs
                    where target_id='a0000000-0000-0000-0000-000000000035' and action='bonus_allocation_snapshots.insert'),
  'snapshot insert produced an audit row');

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- runs: read HR/Finance/Auditor; Employee/Manager excluded; cross-tenant ----
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_calculation_runs where id='a0000000-0000-0000-0000-000000000032'),
  1::bigint, 'HR can read a calculation run');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.bonus_calculation_runs where id='a0000000-0000-0000-0000-000000000032'),
  1::bigint, 'Finance can read a calculation run');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.bonus_calculation_runs where id='a0000000-0000-0000-0000-000000000032'),
  1::bigint, 'Auditor can read a calculation run');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.bonus_calculation_runs where id='a0000000-0000-0000-0000-000000000032'),
  0::bigint, 'employee cannot read a calculation run');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_calculation_runs where id='b0000000-0000-0000-0000-000000000032'),
  0::bigint, 'cross-tenant: HR A cannot read org B run (SI-7)');

-- ---- allocations: employee-own + HR + Auditor; Finance view-only (excluded) -----
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_allocations
             where id in ('a0000000-0000-0000-0000-000000000033','a0000000-0000-0000-0000-000000000034')),
  2::bigint, 'HR can read org allocations');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.bonus_allocations
             where id in ('a0000000-0000-0000-0000-000000000033','a0000000-0000-0000-0000-000000000034')),
  2::bigint, 'Auditor can read org allocations');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.bonus_allocations where id='a0000000-0000-0000-0000-000000000033'),
  1::bigint, 'employee can read OWN allocation');
select is((select count(*) from public.bonus_allocations where id='a0000000-0000-0000-0000-000000000034'),
  0::bigint, 'employee cannot read another employee allocation');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.bonus_allocations where id='a0000000-0000-0000-0000-000000000033'),
  0::bigint, 'Finance cannot read RAW allocation (view-only — SI-12)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.bonus_allocations where id='a0000000-0000-0000-0000-000000000033'),
  0::bigint, 'manager cannot read allocation');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_allocations where id='b0000000-0000-0000-0000-000000000033'),
  0::bigint, 'cross-tenant: HR A cannot read org B allocation (SI-7)');

-- ---- snapshots: read HR/Finance/Auditor; Employee excluded; cross-tenant --------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_allocation_snapshots where id='a0000000-0000-0000-0000-000000000035'),
  1::bigint, 'HR can read a snapshot');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.bonus_allocation_snapshots where id='a0000000-0000-0000-0000-000000000035'),
  1::bigint, 'Finance can read a snapshot');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.bonus_allocation_snapshots where id='a0000000-0000-0000-0000-000000000035'),
  1::bigint, 'Auditor can read a snapshot');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.bonus_allocation_snapshots where id='a0000000-0000-0000-0000-000000000035'),
  0::bigint, 'employee cannot read a snapshot');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.bonus_allocation_snapshots where id='b0000000-0000-0000-0000-000000000035'),
  0::bigint, 'cross-tenant: HR A cannot read org B snapshot (SI-7)');

-- ---- server-only writes: no authenticated INSERT (no privilege) -----------------
select throws_ok(
  $$ insert into public.bonus_calculation_runs (organization_id, bonus_period_id, bonus_pool_id, idempotency_key, triggered_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000030','a0000000-0000-0000-0000-000000000031','client-run','a0000000-0000-0000-0000-0000000000a3') $$,
  '42501', 'permission denied for table bonus_calculation_runs',
  'authenticated cannot INSERT a run (server-only)');
select throws_ok(
  $$ insert into public.bonus_allocations (organization_id, calculation_run_id, bonus_period_id, employee_id, adjusted_score, raw_share_minor, final_amount_minor, status)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000032','a0000000-0000-0000-0000-000000000030','a0000000-0000-0000-0000-0000000000a7',1,1,1,'calculated') $$,
  '42501', 'permission denied for table bonus_allocations',
  'authenticated cannot INSERT an allocation (server-only)');
select throws_ok(
  $$ insert into public.bonus_allocation_snapshots (organization_id, calculation_run_id, bonus_period_id, bonus_pool_id, t_org)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000032','a0000000-0000-0000-0000-000000000030','a0000000-0000-0000-0000-000000000031',1) $$,
  '42501', 'permission denied for table bonus_allocation_snapshots',
  'authenticated cannot INSERT a snapshot (server-only)');

reset role;
select * from finish();
rollback;
