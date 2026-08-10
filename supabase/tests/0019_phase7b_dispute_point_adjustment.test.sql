-- =============================================================================
-- pgTAP — Phase 7-B blocking suite: dispute point adjustment
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 07 §62, 19 §5.2, 0025 (the slice), Decision Lock D9/D2; ADR-005 append-only.
--       apply_dispute_point_adjustment(): resolved+accepted dispute -> one point_ledger
--       dispute_adjustment delta for the complainant; idempotent per dispute; audited.
--
-- Builds three inline Org C (ceres) disputes (complainant 201/Ali, decision_owner c5,
-- reviewer c3/HR) walked through the state machine. request.jwt.claims is set to a valid
-- member so the disputes auto-event trigger (actor_id = auth.uid()) gets a non-null actor;
-- the privileged (bypassrls) runner does the transitions. All UUIDs are deterministic.
-- =============================================================================
begin;
select no_plan();

-- Claims = HR c3 so the dispute auto-events (log_dispute_event, actor = auth.uid()) get a
-- valid actor; the privileged runner bypasses RLS for the transitions below.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c3"}', true);

-- ---- helper: build a dispute and walk it (open -> under_review [-> resolved]) ----------
create function _b7_dispute(p_id uuid, p_final text, p_resolution text)
returns void language plpgsql as $$
begin
  insert into public.disputes
    (id, organization_id, complainant_id, dispute_type, target_type, target_id, decision_owner_id)
  values
    (p_id, 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
     'task_points_too_low', 'point_ledger', gen_random_uuid(), 'c0000000-0000-0000-0000-0000000000c5');
  update public.disputes
    set status = 'under_review', assigned_reviewer_id = 'c0000000-0000-0000-0000-0000000000c3'
    where id = p_id;
  if p_final = 'resolved' then
    update public.disputes
      set status = 'resolved', resolution = p_resolution, decision_note = '7-B fixture', resolved_at = now()
      where id = p_id;
  end if;
end $$;

select _b7_dispute('c0000000-0000-0000-0000-0000000007b1', 'resolved', 'accepted');   -- accepted
select _b7_dispute('c0000000-0000-0000-0000-0000000007b2', 'resolved', 'rejected');   -- rejected
select _b7_dispute('c0000000-0000-0000-0000-0000000007b3', 'under_review', null);     -- not resolved

-- =============================================================================
-- SECTION A — engine (privileged; auth.uid() = c3, has dispute.resolve)
-- =============================================================================

-- (#1) Function exists.
select has_function('public', 'apply_dispute_point_adjustment', 'apply_dispute_point_adjustment exists');

-- (#2) Positive: resolved+accepted dispute -> one dispute_adjustment delta for the complainant.
select lives_ok(
  $$ select public.apply_dispute_point_adjustment('c0000000-0000-0000-0000-0000000007b1', 50, 'accepted: +50', 'c0000000-0000-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-000000000230') $$,
  'apply on a resolved+accepted dispute succeeds');
select is(
  (select count(*) from public.point_ledger where dispute_id = 'c0000000-0000-0000-0000-0000000007b1' and event_type = 'dispute_adjustment'),
  1::bigint, 'exactly one dispute_adjustment row for the dispute');
select is(
  (select points_delta from public.point_ledger where dispute_id = 'c0000000-0000-0000-0000-0000000007b1' and event_type = 'dispute_adjustment'),
  50::numeric, 'dispute_adjustment carries the delta (50)');
select is(
  (select employee_id from public.point_ledger where dispute_id = 'c0000000-0000-0000-0000-0000000007b1' and event_type = 'dispute_adjustment'),
  'a0000000-0000-0000-0000-000000000201'::uuid, 'employee_id = the dispute complainant (OQ-7B-2)');

-- (#3) Negative: a resolved+REJECTED dispute is rejected fail-closed (OQ-7B-3).
select throws_ok(
  $$ select public.apply_dispute_point_adjustment('c0000000-0000-0000-0000-0000000007b2', 50, 'x', 'c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'rejected dispute -> 23514 (no adjustment, fail-closed)');

-- (#4) Negative: a not-yet-resolved (under_review) dispute is rejected.
select throws_ok(
  $$ select public.apply_dispute_point_adjustment('c0000000-0000-0000-0000-0000000007b3', 50, 'x', 'c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'under_review dispute -> 23514 (not resolved+accepted)');

-- (#5) Negative: a zero delta is rejected (OQ-7B-5). (accepted dispute; only the zero check can fire.)
select throws_ok(
  $$ select public.apply_dispute_point_adjustment('c0000000-0000-0000-0000-0000000007b1', 0, 'zero', 'c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'zero delta -> 23514');

-- (#6) Idempotency: a second apply on the same dispute is a no-op (returns the existing row id).
select is(
  (select public.apply_dispute_point_adjustment('c0000000-0000-0000-0000-0000000007b1', 999, 'second', 'c0000000-0000-0000-0000-0000000000c3')),
  (select id from public.point_ledger where dispute_id = 'c0000000-0000-0000-0000-0000000007b1' and event_type = 'dispute_adjustment'),
  'second apply returns the existing row id (idempotent no-op)');
select is(
  (select count(*) from public.point_ledger where dispute_id = 'c0000000-0000-0000-0000-0000000007b1' and event_type = 'dispute_adjustment'),
  1::bigint, 're-apply adds no new row');

-- (#7) Idempotency backstop: a direct duplicate dispute_adjustment for the same dispute -> 23505.
select throws_ok(
  $$ insert into public.point_ledger (organization_id, employee_id, event_type, points_delta, reason, dispute_id, bonus_period_id, created_by)
     values ('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000201','dispute_adjustment',10,'dup','c0000000-0000-0000-0000-0000000007b1','a0000000-0000-0000-0000-000000000230','c0000000-0000-0000-0000-0000000000c3') $$,
  '23505', NULL, 'duplicate dispute_adjustment for the same dispute -> 23505 (unique index)');

-- (#8) Constraint: a dispute_adjustment WITHOUT a dispute_id is rejected.
select throws_ok(
  $$ insert into public.point_ledger (organization_id, employee_id, event_type, points_delta, reason, created_by)
     values ('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000201','dispute_adjustment',10,'no-dispute','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'dispute_adjustment without dispute_id -> 23514 (point_ledger_dispute_adjustment_chk)');

-- (#9) Regression: an invalid event_type is still rejected by the same-named CHECK (0003).
select throws_ok(
  $$ insert into public.point_ledger (organization_id, employee_id, event_type, points_delta, reason, created_by)
     values ('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000201','invalid_event_type',1,'x','c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'invalid event_type still rejected by point_ledger_event_type_chk (0003 regression)');

-- (#10) Audit: applying the adjustment produced an audit_logs row for the point_ledger insert.
select ok(
  exists (select 1 from public.audit_logs
            where action = 'point_ledger.insert'
              and target_id = (select id from public.point_ledger
                                 where dispute_id = 'c0000000-0000-0000-0000-0000000007b1'
                                   and event_type = 'dispute_adjustment')),
  'dispute_adjustment insert creates an audit_logs row (WHEN clause widened)');

-- (#11) Append-only: the dispute_adjustment row cannot be mutated (ADR-005/SI-2).
select throws_ok(
  $$ update public.point_ledger set points_delta = 1 where dispute_id = 'c0000000-0000-0000-0000-0000000007b1' and event_type = 'dispute_adjustment' $$,
  '23001', NULL, 'dispute_adjustment row is append-only (UPDATE -> 23001)');

-- (#12) Cross-tenant (SI-7): a dispute_adjustment pairing an Org C dispute with Org A is
-- rejected by the same-org composite FK (dispute_id, organization_id) -> disputes.
select throws_ok(
  $$ insert into public.point_ledger (organization_id, employee_id, event_type, points_delta, reason, dispute_id, bonus_period_id, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a7','dispute_adjustment',10,'x-tenant','c0000000-0000-0000-0000-0000000007b3','a0000000-0000-0000-0000-0000000000fa','a0000000-0000-0000-0000-0000000000a3') $$,
  '23503', NULL, 'cross-org dispute_id/organization_id pairing rejected by same-org FK (SI-7)');

-- =============================================================================
-- SECTION B — authz as an authenticated caller
-- =============================================================================
set local role authenticated;

-- (#13) An authenticated employee WITHOUT dispute.resolve (Ali 201) is rejected 42501.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000201"}', true);
select throws_ok(
  $$ select public.apply_dispute_point_adjustment('c0000000-0000-0000-0000-0000000007b1', 10, 'x', 'a0000000-0000-0000-0000-000000000201') $$,
  '42501', NULL, 'authenticated employee without dispute.resolve -> 42501');

reset role;
select * from finish();
rollback;
