-- =============================================================================
-- pgTAP — Phase 7-D blocking suite: dispute_adjustment → bonus basis
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 05_BONUS_ENGINE_SPEC, 07_DISPUTE_WORKFLOW_SPEC, 0028; Decision Lock D1/D2/D10.
--       run_bonus_calculation() now sums dispute_adjustment (attributed by bonus_period_id)
--       into NET approved_points; runs on a 'calculated' period; factors carry the breakdown.
--
-- Reuses the seeded Org C worked example (period 230 / pool 231, 10,000,000, T=1; Ali 201
-- baseline final = 3,177,630 — doc-05 §8 / test 0015). request.jwt.claims = HR c3 so the
-- dispute auto-events get a valid actor and run_bonus_calculation authz passes (period.manage).
-- All UUIDs are seed-deterministic. One rolled-back transaction.
-- =============================================================================
begin;
select no_plan();

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c3"}', true);

-- helper: NET approved_points from a run's Ali allocation factors (by idempotency key).
create function _b7d_ap(p_key text, p_emp uuid)
returns numeric language sql as $$
  select (a.factors->>'approved_points')::numeric
  from public.bonus_allocations a
  join public.bonus_calculation_runs r on r.id = a.calculation_run_id and r.organization_id = a.organization_id
  where r.idempotency_key = p_key and r.organization_id = 'c0000000-0000-0000-0000-000000000003' and a.employee_id = p_emp;
$$;

-- helper: dispute_adjustment_points from a run's Ali allocation factors.
create function _b7d_dp(p_key text, p_emp uuid)
returns numeric language sql as $$
  select (a.factors->>'dispute_adjustment_points')::numeric
  from public.bonus_allocations a
  join public.bonus_calculation_runs r on r.id = a.calculation_run_id and r.organization_id = a.organization_id
  where r.idempotency_key = p_key and r.organization_id = 'c0000000-0000-0000-0000-000000000003' and a.employee_id = p_emp;
$$;

-- helper: final_amount from a run's allocation.
create function _b7d_final(p_key text, p_emp uuid)
returns bigint language sql as $$
  select a.final_amount_minor
  from public.bonus_allocations a
  join public.bonus_calculation_runs r on r.id = a.calculation_run_id and r.organization_id = a.organization_id
  where r.idempotency_key = p_key and r.organization_id = 'c0000000-0000-0000-0000-000000000003' and a.employee_id = p_emp;
$$;

-- helper: build a resolved+accepted Org C dispute for complainant Ali (201).
create function _b7d_dispute(p_id uuid)
returns void language plpgsql as $$
begin
  insert into public.disputes
    (id, organization_id, complainant_id, dispute_type, target_type, target_id, decision_owner_id)
  values
    (p_id, 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
     'task_points_too_low', 'point_ledger', gen_random_uuid(), 'c0000000-0000-0000-0000-0000000000c5');
  update public.disputes set status = 'under_review', assigned_reviewer_id = 'c0000000-0000-0000-0000-0000000000c3' where id = p_id;
  update public.disputes set status = 'resolved', resolution = 'accepted', decision_note = '7-D fixture', resolved_at = now() where id = p_id;
end $$;

-- =============================================================================
-- SECTION A — dispute_adjustment enters the bonus basis
-- =============================================================================
-- (#1) Functions exist.
select has_function('public', 'apply_dispute_point_adjustment', 'apply_dispute_point_adjustment exists');

-- Baseline run (no dispute) — reproduces the doc-05 §8 worked example.
select public.run_bonus_calculation(
  'c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230',
  'a0000000-0000-0000-0000-000000000231','7dr1','c0000000-0000-0000-0000-0000000000c3');

-- (#2) Regression baseline: Ali's final = 3,177,630 (matches 0015; no dispute yet).
select is(_b7d_final('7dr1','a0000000-0000-0000-0000-000000000201'), 3177630::bigint,
  'baseline run reproduces the doc-05 §8 worked example (Ali = 3,177,630)');

-- A dispute for Ali, resolved+accepted, +1,000,000 points attributed to period 230.
select _b7d_dispute('c0000000-0000-0000-0000-0000000007d1');
select lives_ok(
  $$ select public.apply_dispute_point_adjustment('c0000000-0000-0000-0000-0000000007d1', 1000000, 'accepted: +1M', 'c0000000-0000-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-000000000230') $$,
  'apply_dispute_point_adjustment succeeds with an explicit bonus_period_id');

-- (#3) The dispute_adjustment row carries bonus_period_id = 230.
select is(
  (select bonus_period_id from public.point_ledger where dispute_id = 'c0000000-0000-0000-0000-0000000007d1' and event_type = 'dispute_adjustment'),
  'a0000000-0000-0000-0000-000000000230'::uuid, 'dispute_adjustment row is attributed to period 230');

-- Second run on the now-'calculated' period (7-D gate widening).
select lives_ok(
  $$ select public.run_bonus_calculation('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','a0000000-0000-0000-0000-000000000231','7dr2','c0000000-0000-0000-0000-0000000000c3') $$,
  'run_bonus_calculation runs on a calculated period (OQ-7D-3 gate)');

-- (#4) The re-run reflects the dispute in NET approved_points (= baseline + 1,000,000).
select is(
  _b7d_ap('7dr2','a0000000-0000-0000-0000-000000000201'),
  _b7d_ap('7dr1','a0000000-0000-0000-0000-000000000201') + 1000000,
  're-run net approved_points = baseline + dispute delta (OQ-7D-1)');

-- (#5) factors jsonb carries the dispute_adjustment_points breakdown (OQ-7D-5).
select is(_b7d_dp('7dr2','a0000000-0000-0000-0000-000000000201'), 1000000::numeric,
  'factors.dispute_adjustment_points = 1,000,000');

-- (#6) Ali's final is non-decreasing (a positive correction cannot lower his share).
select ok(
  _b7d_final('7dr2','a0000000-0000-0000-0000-000000000201') >= _b7d_final('7dr1','a0000000-0000-0000-0000-000000000201'),
  'a positive dispute delta does not lower the complainant final');

-- (#7) SI-13 preserved in the re-run: Σfinal + undistributed = pool_ref.
select is(
  (select coalesce(sum(a.final_amount_minor),0)::bigint from public.bonus_allocations a
   join public.bonus_calculation_runs r on r.id=a.calculation_run_id and r.organization_id=a.organization_id
   where r.idempotency_key='7dr2' and r.organization_id='c0000000-0000-0000-0000-000000000003')
  + (select s.undistributed_remainder_minor from public.bonus_allocation_snapshots s
     join public.bonus_calculation_runs r on r.id=s.calculation_run_id and r.organization_id=s.organization_id
     where r.idempotency_key='7dr2' and r.organization_id='c0000000-0000-0000-0000-000000000003'),
  (select (s.calculation_metadata->>'pool_ref_minor')::bigint from public.bonus_allocation_snapshots s
   join public.bonus_calculation_runs r on r.id=s.calculation_run_id and r.organization_id=s.organization_id
   where r.idempotency_key='7dr2' and r.organization_id='c0000000-0000-0000-0000-000000000003'),
  'SI-13: Σfinal + undistributed = pool_ref in the dispute-adjusted re-run');

-- (#8) net ≤ 0: a huge negative dispute_adjustment excludes the employee (OQ-7D-4).
select _b7d_dispute('c0000000-0000-0000-0000-0000000007d2');
select public.apply_dispute_point_adjustment('c0000000-0000-0000-0000-0000000007d2', -999999999, 'accepted: net neg', 'c0000000-0000-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-000000000230');
select public.run_bonus_calculation(
  'c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','a0000000-0000-0000-0000-000000000231','7dr3','c0000000-0000-0000-0000-0000000000c3');
select is(_b7d_final('7dr3','a0000000-0000-0000-0000-000000000201'), NULL::bigint,
  'net ≤ 0 employee is excluded (no allocation; 0 bonus)');

-- (#9) Idempotency preserved: re-run with the SAME key adds no new run.
select is(
  (select count(*) from public.bonus_calculation_runs where bonus_period_id='a0000000-0000-0000-0000-000000000230' and idempotency_key='7dr2'),
  1::bigint, 'idempotency key uniqueness preserved (one run per key)');

-- =============================================================================
-- SECTION B — period attribution CHECK / FK
-- =============================================================================
select _b7d_dispute('c0000000-0000-0000-0000-0000000007d3');   -- resolved+accepted, no adjustment yet

-- (#10) dispute_adjustment WITHOUT bonus_period_id → CHECK 23514 (via the 4-arg default NULL).
select throws_ok(
  $$ select public.apply_dispute_point_adjustment('c0000000-0000-0000-0000-0000000007d3', 50, 'no-period', 'c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'dispute_adjustment without bonus_period_id → 23514 (point_ledger_bonus_period_event_chk)');

-- (#11) a NON-dispute event with a bonus_period_id set → CHECK 23514.
select throws_ok(
  $$ insert into public.point_ledger (organization_id, employee_id, event_type, points_delta, reason, bonus_period_id, created_by)
     values ('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000201','manual_adjustment',10,'x','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'non-dispute event with bonus_period_id set → 23514 (CHECK)');

-- (#12) cross-org bonus_period_id (Org A period on an Org C row) → composite FK 23503.
select throws_ok(
  $$ insert into public.point_ledger (organization_id, employee_id, event_type, points_delta, reason, dispute_id, bonus_period_id, created_by)
     values ('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000201','dispute_adjustment',10,'x-org','c0000000-0000-0000-0000-0000000007d3','a0000000-0000-0000-0000-0000000000fa','c0000000-0000-0000-0000-0000000000c3') $$,
  '23503', NULL, 'cross-org bonus_period_id rejected by same-org composite FK (SI-7)');

-- =============================================================================
-- SECTION C — regression + gate + catalog
-- =============================================================================
-- (#13) 'approved' period is still rejected (gate stays narrow beyond locked/calculated).
update public.bonus_periods set status = 'approved' where id = 'a0000000-0000-0000-0000-000000000230' and status = 'calculated';
select throws_ok(
  $$ select public.run_bonus_calculation('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','a0000000-0000-0000-0000-000000000231','7dr4','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'run on an approved period is rejected (gate = locked/calculated only)');

-- (#14) permission catalog unchanged.
select is((select count(*) from public.permissions), 20::bigint, 'permission catalog stays 20');

-- =============================================================================
-- SECTION D — authz
-- =============================================================================
set local role authenticated;

-- (#15) authenticated Finance c4 (no period.manage) → run_bonus_calculation → 42501.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c4"}', true);
select throws_ok(
  $$ select public.run_bonus_calculation('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','a0000000-0000-0000-0000-000000000231','7dr5','c0000000-0000-0000-0000-0000000000c4') $$,
  '42501', NULL, 'authenticated Finance without period.manage → 42501');

reset role;
select * from finish();
rollback;
