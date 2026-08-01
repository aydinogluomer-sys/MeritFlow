-- =============================================================================
-- pgTAP — Phase 5 blocking suite: scoring engine (approve → point_ledger)
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 04 (formula/multipliers), 14/15 (point_ledger), 16 (§1, SI-1/SI-2/SI-11/SI-12),
--       Decision Lock D3/AD4/AD5/AD7. Phase 5.
--
-- Section A = privileged (schema + inline fixtures + idempotency). Section B = RLS as
-- authenticated (review-driven approve → scoring). Determinism vector: task 100 =
-- 100 · 1.25(medium) · 1.5(high) · 1.0(good) · 1.0(on_time) · (1-0) = 187.5.
--
-- Seed: task 100 (f1/a7, submitted, policy d2 populated). Inline: 140 (draft policy d3),
-- 141 (revision_count 6), 142 (AD5 twin of 100).
-- =============================================================================
begin;
select no_plan();

-- =============================================================================
-- SECTION A — privileged (bypassrls, trusted)
-- =============================================================================

-- (#1) Schema changes exist.
select has_column('public', 'point_ledger', 'task_id', 'point_ledger.task_id added');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='point_ledger_task_approved_uq'),
  'idempotency index point_ledger_task_approved_uq exists (SI-1)');
select is((select data_type from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='final_points'),
  'numeric', 'tasks.final_points is numeric (C)');

-- (#2) event_type CHECK now accepts task_approved (with its required fields).
select lives_ok(
  $$ insert into public.point_ledger (organization_id, employee_id, event_type, points_delta, reason, scoring_policy_version_id, task_id, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a8','task_approved',50,'seed idempo','a0000000-0000-0000-0000-0000000000d2','a0000000-0000-0000-0000-000000000101','a0000000-0000-0000-0000-0000000000a3') $$,
  'a task_approved ledger row can be written (server/privileged)');

-- (#3) SI-1 idempotency: a second task_approved for the same task is rejected.
select throws_ok(
  $$ insert into public.point_ledger (organization_id, employee_id, event_type, points_delta, reason, scoring_policy_version_id, task_id, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a8','task_approved',50,'dup','a0000000-0000-0000-0000-0000000000d2','a0000000-0000-0000-0000-000000000101','a0000000-0000-0000-0000-0000000000a3') $$,
  '23505', null, 'second task_approved row for the same task rejected (SI-1)');

-- (#4) task_approved CHECK: requires task_id + policy version, and not a reversal.
select throws_ok(
  $$ insert into public.point_ledger (organization_id, employee_id, event_type, points_delta, reason, scoring_policy_version_id, task_id, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a8','task_approved',10,'x','a0000000-0000-0000-0000-0000000000d2', null,'a0000000-0000-0000-0000-0000000000a3') $$,
  '23514', 'new row for relation "point_ledger" violates check constraint "point_ledger_task_approved_chk"',
  'task_approved requires task_id (H)');

-- (#5) same-org composite FK for task_id.
select throws_ok(
  $$ insert into public.point_ledger (organization_id, employee_id, event_type, points_delta, reason, scoring_policy_version_id, task_id, created_by)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000a8','task_approved',10,'x','a0000000-0000-0000-0000-0000000000d2','a0000000-0000-0000-0000-0000000000ff','a0000000-0000-0000-0000-0000000000a3') $$,
  '23503', 'insert or update on table "point_ledger" violates foreign key constraint "point_ledger_task_org_fk"',
  'cross/unknown task_id rejected (SI-7)');

-- ---- inline fixtures (walked in the trusted context) --------------------------------
-- 140: references the DRAFT policy version d3 (AD7 test).
insert into public.tasks (id, organization_id, team_id, title, status, created_by, assigned_to, reviewer_id, complexity, impact, base_points, scoring_policy_version_id)
  values ('a0000000-0000-0000-0000-000000000140','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','draft-policy','assigned','a0000000-0000-0000-0000-0000000000a5','a0000000-0000-0000-0000-0000000000a7','a0000000-0000-0000-0000-0000000000a5','medium','high',100,'a0000000-0000-0000-0000-0000000000d3');
update public.tasks set status='in_progress' where id='a0000000-0000-0000-0000-000000000140';
update public.tasks set status='submitted'   where id='a0000000-0000-0000-0000-000000000140';
-- 141: revision_count 6 (penalty cap test).
insert into public.tasks (id, organization_id, team_id, title, status, created_by, assigned_to, reviewer_id, complexity, impact, base_points, scoring_policy_version_id)
  values ('a0000000-0000-0000-0000-000000000141','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','rev6','assigned','a0000000-0000-0000-0000-0000000000a5','a0000000-0000-0000-0000-0000000000a7','a0000000-0000-0000-0000-0000000000a5','medium','high',100,'a0000000-0000-0000-0000-0000000000d2');
update public.tasks set status='in_progress' where id='a0000000-0000-0000-0000-000000000141';
update public.tasks set status='submitted'   where id='a0000000-0000-0000-0000-000000000141';
do $$ begin
  for i in 1..6 loop
    update public.tasks set status='needs_revision' where id='a0000000-0000-0000-0000-000000000141';
    update public.tasks set status='in_progress'    where id='a0000000-0000-0000-0000-000000000141';
    update public.tasks set status='submitted'       where id='a0000000-0000-0000-0000-000000000141';
  end loop;
end $$;
select is((select revision_count from public.tasks where id='a0000000-0000-0000-0000-000000000141'), 6, 'fixture 141 has revision_count 6');
-- 142: AD5 twin of task 100 (identical inputs).
insert into public.tasks (id, organization_id, team_id, title, status, created_by, assigned_to, reviewer_id, complexity, impact, base_points, scoring_policy_version_id)
  values ('a0000000-0000-0000-0000-000000000142','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-0000000000f1','ad5-twin','assigned','a0000000-0000-0000-0000-0000000000a5','a0000000-0000-0000-0000-0000000000a7','a0000000-0000-0000-0000-0000000000a5','medium','high',100,'a0000000-0000-0000-0000-0000000000d2');
update public.tasks set status='in_progress' where id='a0000000-0000-0000-0000-000000000142';
update public.tasks set status='submitted'   where id='a0000000-0000-0000-0000-000000000142';

-- (#6) permission catalog unchanged.
select is((select count(*) from public.permissions), 20::bigint, 'permission catalog unchanged (20) — no new permission');

-- =============================================================================
-- SECTION B — RLS as authenticated users
-- =============================================================================
set local role authenticated;

-- ---- determinism: approve task 100 -> exactly one task_approved row = 187.5 -----------
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a5"}', true);
select lives_ok(
  $$ insert into public.task_reviews (organization_id, task_id, reviewer_id, decision, quality, timeliness)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000100','a0000000-0000-0000-0000-0000000000a5','approve','good','on_time') $$,
  'reviewer approves task 100');
-- AD5 twin: same inputs, different collaboration_score -> must not change the score.
select lives_ok(
  $$ insert into public.task_reviews (organization_id, task_id, reviewer_id, decision, quality, timeliness, collaboration_score)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000142','a0000000-0000-0000-0000-0000000000a5','approve','good','on_time','excellent') $$,
  'reviewer approves AD5 twin (task 142) with collaboration_score');
-- revision cap: approve task 141 (revision_count 6).
select lives_ok(
  $$ insert into public.task_reviews (organization_id, task_id, reviewer_id, decision, quality, timeliness)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000141','a0000000-0000-0000-0000-0000000000a5','approve','good','on_time') $$,
  'reviewer approves revision-6 task 141');

-- ---- AD7: draft policy version cannot score (approve raises) --------------------------
select throws_ok(
  $$ insert into public.task_reviews (organization_id, task_id, reviewer_id, decision, quality, timeliness)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000140','a0000000-0000-0000-0000-0000000000a5','approve','good','on_time') $$,
  '23514', 'cannot score with a non-published scoring_policy_version (status draft) — AD7',
  'draft policy version cannot score an approved task (AD7)');

-- ---- D3: approve with quality=poor still rejected before scoring (task 102) -----------
select throws_ok(
  $$ insert into public.task_reviews (organization_id, task_id, reviewer_id, decision, quality, timeliness)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000102','a0000000-0000-0000-0000-0000000000a5','approve','poor','on_time') $$,
  '23514', 'new row for relation "task_reviews" violates check constraint "task_reviews_approve_quality_chk"',
  'approve+quality=poor rejected before scoring (D3)');
-- reject task 102 -> no ledger row.
select lives_ok(
  $$ insert into public.task_reviews (organization_id, task_id, reviewer_id, decision, quality, timeliness)
     values ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000102','a0000000-0000-0000-0000-0000000000a5','reject','acceptable','on_time') $$,
  'reviewer rejects task 102');

-- ---- Finance excluded from raw point_ledger scoring rows (SI-12) ----------------------
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000100'),
  0::bigint, 'Finance cannot read raw task_approved ledger row (SI-12)');
-- Employee sees own earning row.
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000100' and event_type='task_approved'),
  1::bigint, 'assignee sees own task_approved earning row');
-- Cross-tenant: org-B user sees nothing.
select set_config('request.jwt.claims','{"sub":"b0000000-0000-0000-0000-0000000000b2"}', true);
select is((select count(*) from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000100'),
  0::bigint, 'cross-tenant: org-B user cannot read org-A earning row (SI-7)');

-- =============================================================================
-- Results (privileged read-back)
-- =============================================================================
reset role;

-- Determinism (task 100 = 187.5) + full row shape.
select is((select points_delta from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000100' and event_type='task_approved'),
  187.5, 'task 100 final_points = 187.5 (deterministic vector)');
select is((select employee_id from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000100' and event_type='task_approved'),
  'a0000000-0000-0000-0000-0000000000a7'::uuid, 'earning row employee = assignee');
select is((select scoring_policy_version_id from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000100' and event_type='task_approved'),
  'a0000000-0000-0000-0000-0000000000d2'::uuid, 'earning row records the policy version');
select is((select (metadata->>'final_points')::numeric from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000100' and event_type='task_approved'),
  187.5, 'breakdown metadata carries final_points');
select ok((select metadata ? 'complexity_multiplier' and metadata ? 'quality_multiplier' from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000100' and event_type='task_approved'),
  'breakdown metadata carries the per-factor multipliers');

-- tasks.final_points cache == ledger points_delta.
select is((select final_points from public.tasks where id='a0000000-0000-0000-0000-000000000100'),
  187.5, 'tasks.final_points cache = 187.5');
select is((select final_points from public.tasks where id='a0000000-0000-0000-0000-000000000100'),
  (select points_delta from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000100' and event_type='task_approved'),
  'tasks.final_points equals ledger points_delta');

-- exactly one earning row for task 100 (SI-1).
select is((select count(*) from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000100' and event_type='task_approved'),
  1::bigint, 'exactly one task_approved row for task 100 (SI-1)');

-- AD5: twin (task 142) has the SAME final_points despite a different collaboration_score.
select is((select final_points from public.tasks where id='a0000000-0000-0000-0000-000000000142'),
  (select final_points from public.tasks where id='a0000000-0000-0000-0000-000000000100'),
  'collaboration_score does not change final_points (AD5)');
select is((select collaboration_score from public.task_reviews where task_id='a0000000-0000-0000-0000-000000000142' and decision='approve'),
  'excellent', 'collaboration_score is recorded on the review (AD5 — informational)');

-- Revision penalty cap: task 141 (rev 6) = 187.5 * (1 - 0.25) = 140.625; rate capped at 0.25.
select is((select final_points from public.tasks where id='a0000000-0000-0000-0000-000000000141'),
  140.625, 'revision penalty caps at 25%: rev6 -> 187.5 * 0.75 = 140.625');
select is((select (metadata->>'revision_penalty_rate')::numeric from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000141' and event_type='task_approved'),
  0.25, 'revision_penalty_rate capped at 0.25 (revision_count 6)');

-- AD4: the earning row reflects the review timeliness (on_time = 1.0), not approval time.
select is((select metadata->>'timeliness' from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000100' and event_type='task_approved'),
  'on_time', 'timeliness taken from the approving review (AD4 — not approval time)');

-- AD7 / D3 boundaries: no earning row for the draft-policy or poor-quality tasks.
select is((select count(*) from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000140' and event_type='task_approved'),
  0::bigint, 'draft-policy task wrote NO earning row (AD7)');
select is((select count(*) from public.point_ledger where task_id='a0000000-0000-0000-0000-000000000102' and event_type='task_approved'),
  0::bigint, 'poor/rejected task 102 wrote NO earning row (D3)');

-- No bonus tables were written by scoring.
select is((select count(*) from public.bonus_ledger), 5::bigint, 'scoring did not write bonus_ledger (seed rows unchanged)');

-- Exactly one audit per approve (Phase 4 tasks.update); no second audit for the ledger row (I).
select is((select count(*) from public.audit_logs where target_id='a0000000-0000-0000-0000-000000000100' and action='point_ledger.insert'),
  0::bigint, 'no separate point_ledger audit for the task_approved row (I)');

select * from finish();
rollback;
