-- =============================================================================
-- pgTAP — Phase 4 blocking suite: tasks + task_events + task_reviews
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 04 (enums), 14/15 (task family), 16 (§1 task machine, §2 review machine),
--       Decision Lock D3/AD4/AD5, ADR-020.
--
-- Section A = privileged (bypassrls, trusted context). Section B = RLS as authenticated.
-- Review-driven transitions (Decision A): a task_reviews INSERT applies the tasks status
-- change; a direct client UPDATE into approved/rejected/needs_revision is rejected. This
-- suite covers the Phase-4 lifecycle; Phase 5 scoring (0020) now writes exactly one
-- task_approved point_ledger row when task 100 is approved (asserted below).
--
-- Seed: tasks 100 (f1/a7, submitted), 101 (f2/a8, in_progress), 102 (f1/a7, submitted),
-- 103 (f1/a5-assignee, submitted).
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls, trusted)
-- =============================================================================

-- (#1) Tables + key columns.
select has_table('public', 'tasks', 'tasks table exists');
select has_table('public', 'task_events', 'task_events table exists');
select has_table('public', 'task_reviews', 'task_reviews table exists');
select has_column('public', 'tasks', 'assigned_to', 'tasks.assigned_to');
select has_column('public', 'tasks', 'reviewer_id', 'tasks.reviewer_id');
select has_column('public', 'tasks', 'last_valid_submitted_at', 'tasks.last_valid_submitted_at');
select has_column('public', 'tasks', 'final_points', 'tasks.final_points');
select has_column('public', 'task_events', 'from_status', 'task_events.from_status');
select has_column('public', 'task_reviews', 'decision', 'task_reviews.decision');
select has_column('public', 'task_reviews', 'collaboration_score', 'task_reviews.collaboration_score');

-- (#2) RLS ENABLED + FORCE.
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.tasks'::regclass), true, 'RLS on tasks');
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.task_events'::regclass), true, 'RLS on task_events');
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.task_reviews'::regclass), true, 'RLS on task_reviews');

-- (#3) Privileges.
select is(has_table_privilege('authenticated','public.tasks','SELECT'), true,  'tasks SELECT');
select is(has_table_privilege('authenticated','public.tasks','INSERT'), true,  'tasks INSERT');
select is(has_table_privilege('authenticated','public.tasks','UPDATE'), true,  'tasks UPDATE');
select is(has_table_privilege('authenticated','public.tasks','DELETE'), false, 'tasks no DELETE');
select is(has_table_privilege('authenticated','public.task_events','SELECT'), true,  'task_events SELECT');
select is(has_table_privilege('authenticated','public.task_events','INSERT'), false, 'task_events no INSERT (server)');
select is(has_table_privilege('authenticated','public.task_events','UPDATE'), false, 'task_events no UPDATE');
select is(has_table_privilege('authenticated','public.task_events','DELETE'), false, 'task_events no DELETE');
select is(has_table_privilege('authenticated','public.task_reviews','SELECT'), true,  'task_reviews SELECT');
select is(has_table_privilege('authenticated','public.task_reviews','INSERT'), true,  'task_reviews INSERT');
select is(has_table_privilege('authenticated','public.task_reviews','UPDATE'), false, 'task_reviews no UPDATE');
select is(has_table_privilege('authenticated','public.task_reviews','DELETE'), false, 'task_reviews no DELETE');

-- (#4) INSERT status guard: a task cannot be created mid-state.
select throws_ok(
  $$ insert into public.tasks (organization_id, team_id, title, status, created_by, assigned_to, complexity, impact, base_points, scoring_policy_version_id)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','bad','submitted','a0000000-0000-0000-0000-0000000000a5','a0000000-0000-0000-0000-0000000000a7','medium','high',10,'a0000000-0000-0000-0000-0000000000d2') $$,
  '23514', 'task must be created in draft or assigned (got submitted)', 'cannot create a mid-state task');

-- (#5) Forbidden transitions (skip-state; approved->in_progress).
insert into public.tasks (id, organization_id, team_id, title, status, created_by, assigned_to, reviewer_id, complexity, impact, base_points, scoring_policy_version_id)
  values ('a0000000-0000-0000-0000-000000000111','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','skip','draft','a0000000-0000-0000-0000-0000000000a5','a0000000-0000-0000-0000-0000000000a7','a0000000-0000-0000-0000-0000000000a5','low','low',5,'a0000000-0000-0000-0000-0000000000d2');
select throws_ok(
  $$ update public.tasks set status='approved' where id='a0000000-0000-0000-0000-000000000111' $$,
  '23514', 'invalid task transition: draft -> approved', 'skip-state draft->approved rejected');
-- walk 112 to approved (trusted), then approved->in_progress rejected.
insert into public.tasks (id, organization_id, team_id, title, status, created_by, assigned_to, reviewer_id, complexity, impact, base_points, scoring_policy_version_id)
  values ('a0000000-0000-0000-0000-000000000112','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','walk','assigned','a0000000-0000-0000-0000-0000000000a5','a0000000-0000-0000-0000-0000000000a7','a0000000-0000-0000-0000-0000000000a5','low','low',5,'a0000000-0000-0000-0000-0000000000d2');
update public.tasks set status='in_progress' where id='a0000000-0000-0000-0000-000000000112';
update public.tasks set status='submitted'   where id='a0000000-0000-0000-0000-000000000112';
update public.tasks set status='approved'    where id='a0000000-0000-0000-0000-000000000112';
select throws_ok(
  $$ update public.tasks set status='in_progress' where id='a0000000-0000-0000-0000-000000000112' $$,
  '23514', 'invalid task transition: approved -> in_progress', 'approved->in_progress rejected (no undo)');

-- (#6) AD4 timing across needs_revision / resubmit (throwaway 110).
insert into public.tasks (id, organization_id, team_id, title, status, created_by, assigned_to, reviewer_id, complexity, impact, base_points, scoring_policy_version_id)
  values ('a0000000-0000-0000-0000-000000000110','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','ad4','assigned','a0000000-0000-0000-0000-0000000000a5','a0000000-0000-0000-0000-0000000000a7','a0000000-0000-0000-0000-0000000000a5','medium','high',30,'a0000000-0000-0000-0000-0000000000d2');
update public.tasks set status='in_progress' where id='a0000000-0000-0000-0000-000000000110';
update public.tasks set status='submitted'   where id='a0000000-0000-0000-0000-000000000110';
create temp table _p4_ad4 as select submitted_at as s1 from public.tasks where id='a0000000-0000-0000-0000-000000000110';
select ok((select submitted_at is not null from public.tasks where id='a0000000-0000-0000-0000-000000000110'), 'submit stamps submitted_at (AD4)');
-- needs_revision preserves submitted_at + increments revision_count.
update public.tasks set status='needs_revision' where id='a0000000-0000-0000-0000-000000000110';
select is((select revision_count from public.tasks where id='a0000000-0000-0000-0000-000000000110'), 1, 'needs_revision increments revision_count');
select is((select submitted_at from public.tasks where id='a0000000-0000-0000-0000-000000000110'), (select s1 from _p4_ad4), 'needs_revision preserves submitted_at (AD4)');
-- resubmit updates submitted_at; revision_count unchanged.
update public.tasks set status='in_progress' where id='a0000000-0000-0000-0000-000000000110';
update public.tasks set status='submitted'   where id='a0000000-0000-0000-0000-000000000110';
select ok((select submitted_at from public.tasks where id='a0000000-0000-0000-0000-000000000110') >= (select s1 from _p4_ad4), 'resubmit refreshes submitted_at (last valid submission — AD4)');
select is((select revision_count from public.tasks where id='a0000000-0000-0000-0000-000000000110'), 1, 'resubmit keeps revision_count');

-- (#7) task_events auto-written + append-only.
select ok(exists(select 1 from public.task_events where task_id='a0000000-0000-0000-0000-000000000110' and event_type='submitted'), 'submit produced a task_event');
select ok(exists(select 1 from public.task_events where task_id='a0000000-0000-0000-0000-000000000110' and event_type='revision_requested'), 'needs_revision produced a task_event');
select throws_ok(
  $$ update public.task_events set to_status='approved' where task_id='a0000000-0000-0000-0000-000000000110' $$,
  '23001', 'append-only: UPDATE on task_events is not permitted', 'task_events UPDATE blocked (append-only)');
select throws_ok(
  $$ delete from public.task_events where task_id='a0000000-0000-0000-0000-000000000110' $$,
  '23001', 'append-only: DELETE on task_events is not permitted', 'task_events DELETE blocked (append-only)');

-- (#8) tasks DELETE forbidden.
select throws_ok(
  $$ delete from public.tasks where id='a0000000-0000-0000-0000-000000000100' $$,
  '23001', 'delete forbidden: tasks is retained (supersede only; deletion is a legal-review item)',
  'tasks DELETE blocked (cancel/archive = status)');

-- (#9) Cross-tenant composite FK negatives (SI-7).
select throws_ok(
  $$ insert into public.tasks (organization_id, team_id, title, status, created_by, assigned_to, complexity, impact, base_points, scoring_policy_version_id)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','x','assigned','a0000000-0000-0000-0000-0000000000a5','b0000000-0000-0000-0000-0000000000b2','low','low',1,'a0000000-0000-0000-0000-0000000000d2') $$,
  '23503', 'insert or update on table "tasks" violates foreign key constraint "tasks_assignee_org_fk"',
  'cross-org assignee rejected (SI-7)');
select throws_ok(
  $$ insert into public.tasks (organization_id, team_id, title, status, created_by, assigned_to, complexity, impact, base_points, scoring_policy_version_id)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','x','assigned','a0000000-0000-0000-0000-0000000000a5','a0000000-0000-0000-0000-0000000000a7','low','low',1,'b0000000-0000-0000-0000-0000000000d2') $$,
  '23503', 'insert or update on table "tasks" violates foreign key constraint "tasks_policy_org_fk"',
  'cross-org scoring_policy_version rejected (SI-7)');

-- (#10) No new permission — catalog matches the 0001 assertion.
select is((select count(*) from public.permissions), 20::bigint, 'permission catalog unchanged (20) — no new task permission');

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- SELECT: Finance excluded; team/assignee/reviewer/HR/Auditor/support visibility ----
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.tasks where id='a0000000-0000-0000-0000-000000000100'), 1::bigint, 'assignee sees own task');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select is((select count(*) from public.tasks where id='a0000000-0000-0000-0000-000000000100'), 1::bigint, 'own-team manager/reviewer sees task');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a6"}', true);
select is((select count(*) from public.tasks where id='a0000000-0000-0000-0000-000000000100'), 0::bigint, 'other-team manager cannot see task');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.tasks where id='a0000000-0000-0000-0000-000000000100'), 1::bigint, 'HR sees task');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.tasks where id='a0000000-0000-0000-0000-000000000100'), 1::bigint, 'Auditor sees task');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.tasks where id='a0000000-0000-0000-0000-000000000100'), 0::bigint, 'Finance cannot see raw task (SI-12)');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000aa"}', true);
select is((select count(*) from public.tasks where id='a0000000-0000-0000-0000-000000000100'), 1::bigint, 'support (active grant) sees task (RO)');
select set_config('request.jwt.claims','{"sub":"b0000000-0000-0000-0000-0000000000b2"}', true);
select is((select count(*) from public.tasks where id='a0000000-0000-0000-0000-000000000100'), 0::bigint, 'cross-tenant: org-B user cannot see org-A task (SI-7)');
-- task_events / task_reviews inherit task visibility: Finance sees neither.
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.task_events where task_id='a0000000-0000-0000-0000-000000000100'), 0::bigint, 'Finance cannot see task_events');

-- ---- INSERT authz ----
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select lives_ok(
  $$ insert into public.tasks (organization_id, team_id, title, status, created_by, assigned_to, complexity, impact, base_points, scoring_policy_version_id)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','mgr-created','assigned','a0000000-0000-0000-0000-0000000000a5','a0000000-0000-0000-0000-0000000000a7','low','low',1,'a0000000-0000-0000-0000-0000000000d2') $$,
  'own-team manager (task.create) can INSERT a task');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select throws_ok(
  $$ insert into public.tasks (organization_id, team_id, title, status, created_by, assigned_to, complexity, impact, base_points, scoring_policy_version_id)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','x','assigned','a0000000-0000-0000-0000-0000000000a7','a0000000-0000-0000-0000-0000000000a7','low','low',1,'a0000000-0000-0000-0000-0000000000d2') $$,
  '42501', 'new row violates row-level security policy for table "tasks"', 'employee cannot INSERT a task (no task.create)');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select throws_ok(
  $$ insert into public.tasks (organization_id, team_id, title, status, created_by, assigned_to, complexity, impact, base_points, scoring_policy_version_id)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f2','x','assigned','a0000000-0000-0000-0000-0000000000a5','a0000000-0000-0000-0000-0000000000a8','low','low',1,'a0000000-0000-0000-0000-0000000000d2') $$,
  '42501', 'new row violates row-level security policy for table "tasks"', 'manager cannot INSERT into a team they do not manage');

-- ---- assignee lifecycle + direct-approve blocked ----
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a8"}', true);
select lives_ok(
  $$ update public.tasks set status='submitted' where id='a0000000-0000-0000-0000-000000000101' $$,
  'assignee can submit own in_progress task');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select throws_ok(
  $$ update public.tasks set status='approved' where id='a0000000-0000-0000-0000-000000000100' $$,
  '23514', 'task approved is review-driven (insert a task_review, not a direct update)',
  'assignee cannot self-approve via direct UPDATE');
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select throws_ok(
  $$ update public.tasks set status='approved' where id='a0000000-0000-0000-0000-000000000100' $$,
  '23514', 'task approved is review-driven (insert a task_review, not a direct update)',
  'manager cannot approve via direct UPDATE (must review)');

-- ---- review-driven approve: valid review changes task status (Phase 5 scores it) ----
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select lives_ok(
  $$ insert into public.task_reviews (organization_id, task_id, reviewer_id, decision, quality, timeliness)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000100','a0000000-0000-0000-0000-0000000000a5','approve','good','on_time') $$,
  'own-team reviewer can approve via task_reviews INSERT');
select is((select status from public.tasks where id='a0000000-0000-0000-0000-000000000100'), 'approved', 'review INSERT drove task -> approved (Decision A)');
select ok(exists(select 1 from public.task_events where task_id='a0000000-0000-0000-0000-000000000100' and event_type='approved'), 'approve produced an approved task_event');

-- ---- self-review block (a5 is the assignee of task 103) ----
select throws_ok(
  $$ insert into public.task_reviews (organization_id, task_id, reviewer_id, decision, quality, timeliness)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000103','a0000000-0000-0000-0000-0000000000a5','approve','good','on_time') $$,
  '23514', 'self-review/approval is not permitted (reviewer = assignee)', 'self-review hard block (AD4)');

-- ---- D3: approve with quality=poor rejected ----
select throws_ok(
  $$ insert into public.task_reviews (organization_id, task_id, reviewer_id, decision, quality, timeliness)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000102','a0000000-0000-0000-0000-0000000000a5','approve','poor','on_time') $$,
  '23514', 'new row for relation "task_reviews" violates check constraint "task_reviews_approve_quality_chk"',
  'approve with quality=poor rejected (D3)');

-- ---- other-team manager cannot review; non-manager reviewer blocked ----
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a6"}', true);
select throws_ok(
  $$ insert into public.task_reviews (organization_id, task_id, reviewer_id, decision, quality, timeliness)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000102','a0000000-0000-0000-0000-0000000000a6','approve','good','on_time') $$,
  '42501', 'reviewer must manage the task team', 'other-team manager cannot review');

-- ---- needs_revision via review: task transitions + revision_count increments ----
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select lives_ok(
  $$ insert into public.task_reviews (organization_id, task_id, reviewer_id, decision, quality, timeliness)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000102','a0000000-0000-0000-0000-0000000000a5','needs_revision','acceptable','on_time') $$,
  'reviewer can request revision via task_reviews INSERT');
select is((select status from public.tasks where id='a0000000-0000-0000-0000-000000000102'), 'needs_revision', 'needs_revision review drove task -> needs_revision');
select is((select revision_count from public.tasks where id='a0000000-0000-0000-0000-000000000102'), 1, 'needs_revision review incremented revision_count');

-- ---- audit + point_ledger (Phase 5 scoring now writes exactly one earning row) ----
reset role;
select ok(exists(select 1 from public.audit_logs where target_id='a0000000-0000-0000-0000-000000000100' and action='tasks.update'), 'approve produced a tasks audit row');
select ok(exists(select 1 from public.audit_logs where action='task_reviews.insert'), 'review INSERT produced an audit row');
-- Phase 5 scoring: approving task 100 (via task_reviews INSERT) writes exactly one
-- point_ledger task_approved row for that task (SI-1). (Was a Phase-4 "no ledger" boundary.)
select is((select count(*) from public.point_ledger
           where task_id='a0000000-0000-0000-0000-000000000100' and event_type='task_approved'),
  1::bigint, 'approve writes exactly one task_approved ledger row (Phase 5 scoring — SI-1)');

select * from finish();
rollback;
