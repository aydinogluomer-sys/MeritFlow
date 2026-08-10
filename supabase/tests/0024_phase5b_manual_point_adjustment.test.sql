-- =============================================================================
-- pgTAP — Phase 5-b blocking suite: manual point override (two-person)
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 0030 (the slice), 0009 (point_ledger append-only + audit trigger), Decision
--       Lock (manual adjustment = reason + audit + separate ledger entry; point.override).
--       apply_manual_point_adjustment(): caller + p_actor + p_second_approver all hold
--       point.override in the same org; distinct approvers; non-zero delta; non-empty
--       reason; employee + optional task same-org; appends one manual_adjustment row;
--       audited by the point_ledger INSERT trigger (action point_ledger.insert).
--
-- Fixture (Org C / ceres): the seed grants point.override to NO role, so this suite
-- grants it to hr + manager (a test-only grant inside the rolled-back txn; the global
-- permissions catalog stays 20). request.jwt.claims = HR C (c3) so auth.uid() = c3 (a
-- valid point.override holder) and the two-person + org guards engage. Caller/actor = c3
-- (hr), second_approver = mgr-c c5 (manager); employee = Ali 201 (team Ceres fc); task =
-- Ali task 210. Org A (acme) is the cross-tenant outsider (caller HR A a3, employee a7,
-- task 100). All UUIDs are seed-deterministic. Runs privileged (bypassrls) — mirrors
-- 0019/0020 SECTION A — with the JWT claim stamping auth.uid() for the guards.
--
-- NOTE: the function is called in its own statement first, then the resulting row is
-- located by its unique reason. Never embed the (volatile) function call inside a
-- WHERE predicate — Postgres could re-evaluate it per row and insert extra rows.
-- =============================================================================
begin;
select plan(17);

-- Test-only grant: point.override to hr + manager (absent from the seed). Rolled back
-- with the txn; does NOT change the permissions catalog count (still 20 — assertion #16).
insert into public.role_permissions (role_key, permission_key) values
  ('hr', 'point.override'),
  ('manager', 'point.override')
on conflict (role_key, permission_key) do nothing;

-- Caller = HR C (c3): a valid point.override holder in Org C.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c3"}', true);

-- ---------------------------------------------------------------------------
-- Positive path (call in its own statement, then assert on the row by reason)
-- ---------------------------------------------------------------------------
select public.apply_manual_point_adjustment(
  'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
  100, 'phase5b: +100', 'c0000000-0000-0000-0000-0000000000c3',
  'c0000000-0000-0000-0000-0000000000c5');
select public.apply_manual_point_adjustment(
  'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
  -50, 'phase5b: -50', 'c0000000-0000-0000-0000-0000000000c3',
  'c0000000-0000-0000-0000-0000000000c5');
select public.apply_manual_point_adjustment(
  'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
  25, 'phase5b: with task', 'c0000000-0000-0000-0000-0000000000c3',
  'c0000000-0000-0000-0000-0000000000c5', 'a0000000-0000-0000-0000-000000000210');
select public.apply_manual_point_adjustment(
  'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
  30, 'phase5b: no task', 'c0000000-0000-0000-0000-0000000000c3',
  'c0000000-0000-0000-0000-0000000000c5');

-- (#0) +100 delta -> ledger row exists (org, emp, manual_adjustment, created_by = actor c3).
select is(
  (select count(*) from public.point_ledger
    where organization_id = 'c0000000-0000-0000-0000-000000000003'
      and employee_id = 'a0000000-0000-0000-0000-000000000201'
      and event_type = 'manual_adjustment' and points_delta = 100
      and reason = 'phase5b: +100'
      and created_by = 'c0000000-0000-0000-0000-0000000000c3'),
  1::bigint, '+100 manual_adjustment row exists (org, emp, event, created_by=actor)');

-- (#1) -50 delta -> row exists.
select is(
  (select count(*) from public.point_ledger
    where employee_id = 'a0000000-0000-0000-0000-000000000201'
      and event_type = 'manual_adjustment' and points_delta = -50
      and reason = 'phase5b: -50'),
  1::bigint, '-50 manual_adjustment row exists');

-- (#2) task_id given (same org) -> row.task_id = that id.
select is(
  (select task_id from public.point_ledger where reason = 'phase5b: with task'),
  'a0000000-0000-0000-0000-000000000210'::uuid, 'task_id given -> row.task_id = that id');

-- (#3) task_id omitted (default NULL) -> row.task_id IS NULL.
select is(
  (select task_id from public.point_ledger where reason = 'phase5b: no task'),
  null, 'task_id omitted -> row.task_id IS NULL');

-- (#4) metadata->>'second_approver' = second_approver::text.
select is(
  (select metadata->>'second_approver' from public.point_ledger where reason = 'phase5b: +100'),
  'c0000000-0000-0000-0000-0000000000c5', 'metadata.second_approver = second approver id');

-- (#5) audit_logs row exists for the +100 insert (target_type point_ledger; action is
--      point_ledger.insert — NOT point.manual_adjustment).
select ok(
  exists (
    select 1 from public.audit_logs al
    where al.target_type = 'point_ledger'
      and al.target_id = (select id from public.point_ledger where reason = 'phase5b: +100')),
  'manual_adjustment insert creates an audit_logs row (point_ledger.insert)');

-- ---------------------------------------------------------------------------
-- Negative — validation (all raise before insert)
-- ---------------------------------------------------------------------------

-- (#6) delta = 0 -> 23514.
select throws_ok(
  $$ select public.apply_manual_point_adjustment(
       'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
       0, 'phase5b: zero', 'c0000000-0000-0000-0000-0000000000c3',
       'c0000000-0000-0000-0000-0000000000c5') $$,
  '23514', NULL, 'zero delta -> 23514');

-- (#7) reason = '' -> 23514.
select throws_ok(
  $$ select public.apply_manual_point_adjustment(
       'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
       10, '', 'c0000000-0000-0000-0000-0000000000c3',
       'c0000000-0000-0000-0000-0000000000c5') $$,
  '23514', NULL, 'empty reason -> 23514');

-- (#8) p_actor = p_second_approver -> 23514.
select throws_ok(
  $$ select public.apply_manual_point_adjustment(
       'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
       10, 'phase5b: same approver', 'c0000000-0000-0000-0000-0000000000c3',
       'c0000000-0000-0000-0000-0000000000c3') $$,
  '23514', NULL, 'actor = second approver -> 23514');

-- ---------------------------------------------------------------------------
-- Negative — authz (caller stays a valid Org C holder; failure attributable to the
-- named actor / second approver / caller org)
-- ---------------------------------------------------------------------------

-- (#9) p_actor lacks point.override (Finance C c4, role finance) -> 42501.
select throws_ok(
  $$ select public.apply_manual_point_adjustment(
       'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
       10, 'phase5b: actor no override', 'c0000000-0000-0000-0000-0000000000c4',
       'c0000000-0000-0000-0000-0000000000c5') $$,
  '42501', NULL, 'actor without point.override -> 42501');

-- (#10) p_second_approver lacks point.override (Finance C c4) -> 42501.
select throws_ok(
  $$ select public.apply_manual_point_adjustment(
       'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
       10, 'phase5b: 2nd no override', 'c0000000-0000-0000-0000-0000000000c3',
       'c0000000-0000-0000-0000-0000000000c4') $$,
  '42501', NULL, 'second approver without point.override -> 42501');

-- (#11) caller is in the OTHER org (HR A a3), p_organization_id = Org C -> 42501
--       (caller org-mismatch guard fires first).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select throws_ok(
  $$ select public.apply_manual_point_adjustment(
       'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
       10, 'phase5b: cross-tenant caller', 'c0000000-0000-0000-0000-0000000000c3',
       'c0000000-0000-0000-0000-0000000000c5') $$,
  '42501', NULL, 'caller in another org for Org C adjustment -> 42501 (caller guard first)');
-- Restore the Org C caller for the remaining assertions.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c3"}', true);

-- ---------------------------------------------------------------------------
-- Negative — cross-tenant employee / task (same-org existence checks)
-- ---------------------------------------------------------------------------

-- (#12) employee is in the OTHER org (a7, Org A), p_organization_id = Org C -> 23503.
select throws_ok(
  $$ select public.apply_manual_point_adjustment(
       'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-0000000000a7',
       10, 'phase5b: cross-tenant employee', 'c0000000-0000-0000-0000-0000000000c3',
       'c0000000-0000-0000-0000-0000000000c5') $$,
  '23503', NULL, 'employee in another org -> 23503');

-- (#13) task_id is in the OTHER org (100, Org A), p_organization_id = Org C -> 23503.
select throws_ok(
  $$ select public.apply_manual_point_adjustment(
       'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000201',
       10, 'phase5b: cross-tenant task', 'c0000000-0000-0000-0000-0000000000c3',
       'c0000000-0000-0000-0000-0000000000c5', 'a0000000-0000-0000-0000-000000000100') $$,
  '23503', NULL, 'task in another org -> 23503');

-- ---------------------------------------------------------------------------
-- Append-only (ADR-005 / SI-2): the manual_adjustment row cannot be mutated.
-- ---------------------------------------------------------------------------

-- (#14) UPDATE -> 23001 (trg_point_ledger_append_only / prevent_mutation).
select throws_ok(
  $$ update public.point_ledger set points_delta = 1 where reason = 'phase5b: +100' $$,
  '23001', NULL, 'manual_adjustment row is append-only (UPDATE -> 23001)');

-- (#15) DELETE -> 23001 (append-only).
select throws_ok(
  $$ delete from public.point_ledger where reason = 'phase5b: +100' $$,
  '23001', NULL, 'manual_adjustment row is append-only (DELETE -> 23001)');

-- ---------------------------------------------------------------------------
-- Catalog invariant.
-- ---------------------------------------------------------------------------

-- (#16) permissions catalog is unchanged (still 20 — the role grant above adds no
--       permission row).
select is(
  (select count(*) from public.permissions),
  20::bigint, 'permissions catalog stays 20 (test-only role grant adds no permission)');

select * from finish();
rollback;
