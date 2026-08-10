-- =============================================================================
-- pgTAP — Phase 7-E blocking suite: dispute bonus re-run orchestration
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 07 §63, 05, 0029; Decision Lock D2/AD10/ADR-006. recalculate_bonus_after_dispute()
--       now: reverse + supersede + approved→calculated, then run_bonus_calculation() to
--       produce a NEW run/snapshot reflecting the dispute_adjustment (7-D). Returns the new
--       snapshot id; period stays 'calculated' (HR re-approves separately — ADR-006).
--
-- Section A reuses the seeded Org C worked example (period 230 / pool 231, 10,000,000, T=1;
-- Ali 201). request.jwt.claims = HR c3 (dispute auto-events + period.manage authz). One
-- rolled-back transaction. All UUIDs are seed-deterministic.
-- =============================================================================
begin;
select no_plan();

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c3"}', true);

-- helpers: run id / snapshot id for a run identified by its idempotency key (Org C).
create function _b7e_run(p_key text)
returns uuid language sql as $$
  select id from public.bonus_calculation_runs
  where organization_id = 'c0000000-0000-0000-0000-000000000003' and idempotency_key = p_key;
$$;
create function _b7e_snap(p_key text)
returns uuid language sql as $$
  select s.id from public.bonus_allocation_snapshots s
  join public.bonus_calculation_runs r on r.id = s.calculation_run_id and r.organization_id = s.organization_id
  where r.organization_id = 'c0000000-0000-0000-0000-000000000003' and r.idempotency_key = p_key;
$$;
-- the deterministic new-run key = 'disp-recalc-snap-' || <the original (reversed) snapshot id>.
create function _b7e_newkey()
returns text language sql as $$
  select 'disp-recalc-snap-' || _b7e_snap('7e-orig')::text;
$$;
create function _b7e_final(p_key text, p_emp uuid)
returns bigint language sql as $$
  select a.final_amount_minor from public.bonus_allocations a
  where a.calculation_run_id = _b7e_run(p_key) and a.employee_id = p_emp;
$$;

-- build a resolved+accepted Org C dispute for complainant Ali (201).
create function _b7e_dispute(p_id uuid)
returns void language plpgsql as $$
begin
  insert into public.disputes
    (id, organization_id, complainant_id, dispute_type, target_type, target_id, decision_owner_id)
  values
    (p_id, 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
     'task_points_too_low', 'point_ledger', gen_random_uuid(), 'c0000000-0000-0000-0000-0000000000c5');
  update public.disputes set status = 'under_review', assigned_reviewer_id = 'c0000000-0000-0000-0000-0000000000c3' where id = p_id;
  update public.disputes set status = 'resolved', resolution = 'accepted', decision_note = '7-E fixture', resolved_at = now() where id = p_id;
end $$;

-- =============================================================================
-- SECTION A — full orchestration worked example
-- =============================================================================
select public.run_bonus_calculation(
  'c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230',
  'a0000000-0000-0000-0000-000000000231','7e-orig','c0000000-0000-0000-0000-0000000000c3');
update public.bonus_periods set status = 'approved'
  where id = 'a0000000-0000-0000-0000-000000000230' and status = 'calculated';
select public.post_bonus_accrual(
  'c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3');
select _b7e_dispute('e0000000-0000-0000-0000-0000000007e1');
select public.apply_dispute_point_adjustment(
  'e0000000-0000-0000-0000-0000000007e1', 1000000, 'phase7e test', 'c0000000-0000-0000-0000-0000000000c3',
  'a0000000-0000-0000-0000-000000000230');

-- (#0) the orchestration succeeds.
select lives_ok(
  $$ select public.recalculate_bonus_after_dispute('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3') $$,
  'recalculate_bonus_after_dispute full orchestration succeeds');

-- (#1) the old accrual is reversed (5 mirror rows: 1 pool debit + 4 employee credits).
select is(
  (select count(*) from public.bonus_ledger where snapshot_id = _b7e_snap('7e-orig') and event_type = 'reversal'),
  5::bigint, 'the original accrual is reversed (5 rows)');

-- (#2) the old run is superseded.
select is((select status from public.bonus_calculation_runs where id = _b7e_run('7e-orig')), 'superseded',
  'the original run is superseded');

-- (#3) the period stays 'calculated' (HR re-approves separately — ADR-006).
select is((select status from public.bonus_periods where id = 'a0000000-0000-0000-0000-000000000230'), 'calculated',
  'period is calculated (re-approval still required)');

-- (#4) a NEW completed run exists under the deterministic key.
select is((select status from public.bonus_calculation_runs where organization_id='c0000000-0000-0000-0000-000000000003' and idempotency_key = _b7e_newkey()),
  'completed', 'a new completed run exists (disp-recalc-snap-<orig>)');

-- (#5) the new snapshot exists and differs from the original.
select ok(_b7e_snap(_b7e_newkey()) is not null and _b7e_snap(_b7e_newkey()) <> _b7e_snap('7e-orig'),
  'a new immutable snapshot is produced (distinct from the reversed one)');

-- (#6) the new allocation reflects the dispute (factors.dispute_adjustment_points).
select is(
  (select (a.factors->>'dispute_adjustment_points')::numeric from public.bonus_allocations a
   where a.calculation_run_id = _b7e_run(_b7e_newkey()) and a.employee_id = 'a0000000-0000-0000-0000-000000000201'),
  1000000::numeric, 'the new run folds the dispute_adjustment into Ali''s basis (7-D)');

-- (#7) SI-13 on the new snapshot: Σfinal + undistributed = pool_ref.
select is(
  (select coalesce(sum(a.final_amount_minor),0)::bigint from public.bonus_allocations a where a.calculation_run_id = _b7e_run(_b7e_newkey()))
  + (select s.undistributed_remainder_minor from public.bonus_allocation_snapshots s where s.calculation_run_id = _b7e_run(_b7e_newkey())),
  (select (s.calculation_metadata->>'pool_ref_minor')::bigint from public.bonus_allocation_snapshots s where s.calculation_run_id = _b7e_run(_b7e_newkey())),
  'SI-13 preserved on the new snapshot (Σfinal + undistributed = pool_ref)');

-- (#8) a positive dispute raised Ali's share: new final > old (superseded-run) final.
select ok(_b7e_final(_b7e_newkey(),'a0000000-0000-0000-0000-000000000201') > _b7e_final('7e-orig','a0000000-0000-0000-0000-000000000201'),
  'the dispute raised the complainant final (new > original)');

-- =============================================================================
-- SECTION B — idempotency
-- =============================================================================
-- (#9) a second call returns the same new snapshot and adds no new reversal / run.
select is(
  (select public.recalculate_bonus_after_dispute('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3')),
  _b7e_snap(_b7e_newkey()), 'second call returns the same new snapshot (fully idempotent)');
select is(
  (select count(*) from public.bonus_ledger where snapshot_id = _b7e_snap('7e-orig') and event_type = 'reversal'),
  5::bigint, 're-call adds no new reversal rows');
select is(
  (select count(*) from public.bonus_calculation_runs where organization_id='c0000000-0000-0000-0000-000000000003' and idempotency_key = _b7e_newkey()),
  1::bigint, 're-call adds no new run');

-- =============================================================================
-- SECTION C — re-accrual still gated (ADR-006)
-- =============================================================================
-- (#10) post_bonus_accrual on the 'calculated' period is rejected (HR must re-approve first).
select throws_ok(
  $$ select public.post_bonus_accrual('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 're-accrual blocked while period is calculated (ADR-006 re-approval)');

-- =============================================================================
-- SECTION D — pool guard (approved+accrued period whose locked pool was superseded)
-- =============================================================================
insert into public.bonus_periods (id, organization_id, period_type, starts_on, ends_on, status, created_by)
  values ('a0000000-0000-0000-0000-00000000079e','c0000000-0000-0000-0000-000000000003','monthly', date '2024-07-01', date '2024-07-31','open','c0000000-0000-0000-0000-0000000000c3');
insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by)
  values ('c0000000-0000-0000-0000-00000000079f','c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000079e', 1000,'TRY','draft','c0000000-0000-0000-0000-0000000000c3');
update public.bonus_pools set status='locked', t_org=1, locked_at=now(), locked_by='c0000000-0000-0000-0000-0000000000c3' where id='c0000000-0000-0000-0000-00000000079f';
update public.bonus_periods set status='locked', locked_at=now(), locked_by='c0000000-0000-0000-0000-0000000000c3' where id='a0000000-0000-0000-0000-00000000079e';
insert into public.bonus_calculation_runs (id, organization_id, bonus_period_id, bonus_pool_id, status, idempotency_key, t_org, triggered_by)
  values ('c0000000-0000-0000-0000-0000000079a1','c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000079e','c0000000-0000-0000-0000-00000000079f','running','7e-pool','1','c0000000-0000-0000-0000-0000000000c3');
update public.bonus_calculation_runs set status='completed', completed_at=now() where id='c0000000-0000-0000-0000-0000000079a1';
insert into public.bonus_allocation_snapshots (id, organization_id, calculation_run_id, bonus_period_id, bonus_pool_id, t_org, undistributed_remainder_minor, calculation_metadata)
  values ('c0000000-0000-0000-0000-0000000079a2','c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-0000000079a1','a0000000-0000-0000-0000-00000000079e','c0000000-0000-0000-0000-00000000079f',1,0,'{}'::jsonb);
update public.bonus_periods set status='calculated' where id='a0000000-0000-0000-0000-00000000079e' and status='locked';
update public.bonus_periods set status='approved'   where id='a0000000-0000-0000-0000-00000000079e' and status='calculated';
-- manual balanced accrual for the snapshot.
insert into public.bonus_ledger
  (organization_id, bonus_pool_id, employee_id, calculation_run_id, snapshot_id, transaction_id, entry_type, account, event_type, amount_minor, reason, created_by)
values
  ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000079f', null, 'c0000000-0000-0000-0000-0000000079a1','c0000000-0000-0000-0000-0000000079a2','c0000000-0000-0000-0000-0000000079a3','debit', 'pool',    'bonus_accrual', 1000, 'manual','c0000000-0000-0000-0000-0000000000c3'),
  ('c0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-00000000079f', 'a0000000-0000-0000-0000-000000000201', 'c0000000-0000-0000-0000-0000000079a1','c0000000-0000-0000-0000-0000000079a2','c0000000-0000-0000-0000-0000000079a3','credit','accrual', 'bonus_accrual', 1000, 'manual','c0000000-0000-0000-0000-0000000000c3');
-- the locked pool is superseded (new version) => no locked pool remains for the period.
update public.bonus_pools set status='superseded' where id='c0000000-0000-0000-0000-00000000079f';

-- (#11) recalculation cannot recompute without a locked pool.
select throws_ok(
  $$ select public.recalculate_bonus_after_dispute('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000079e','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'no locked bonus_pool for the period → 23514 (pool guard)');

-- =============================================================================
-- SECTION E — precondition: a period with no accrual is rejected
-- =============================================================================
insert into public.bonus_periods (id, organization_id, period_type, starts_on, ends_on, status, created_by)
  values ('a0000000-0000-0000-0000-00000000079b','c0000000-0000-0000-0000-000000000003','monthly', date '2024-08-01', date '2024-08-31','open','c0000000-0000-0000-0000-0000000000c3');
insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by)
  values ('c0000000-0000-0000-0000-00000000079c','c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000079b', 1000,'TRY','draft','c0000000-0000-0000-0000-0000000000c3');
update public.bonus_pools set status='locked', t_org=1, locked_at=now(), locked_by='c0000000-0000-0000-0000-0000000000c3' where id='c0000000-0000-0000-0000-00000000079c';
update public.bonus_periods set status='locked', locked_at=now(), locked_by='c0000000-0000-0000-0000-0000000000c3' where id='a0000000-0000-0000-0000-00000000079b';

-- (#12) a 'locked' period with no accrual → precondition fails (requires approved).
select throws_ok(
  $$ select public.recalculate_bonus_after_dispute('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000079b','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'a period with no accrual → 23514 (requires an approved bonus_period)');

-- =============================================================================
-- SECTION F — authz + catalog
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c4"}', true);

-- (#13) authenticated Finance c4 (no period.manage) → 42501.
select throws_ok(
  $$ select public.recalculate_bonus_after_dispute('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c4') $$,
  '42501', NULL, 'authenticated Finance without period.manage → 42501');

reset role;

-- (#14) permission catalog unchanged.
select is((select count(*) from public.permissions), 20::bigint, 'permission catalog stays 20');

select * from finish();
rollback;
