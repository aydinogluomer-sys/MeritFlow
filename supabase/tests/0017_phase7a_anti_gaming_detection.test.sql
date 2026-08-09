-- =============================================================================
-- pgTAP — Phase 7-A blocking suite: anti-gaming detection engine
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 08 (5 rules), 19 (locked OQ), 0016 (container), 0023 (detection), D5.
--
-- run_anti_gaming_scan() produces flags into anti_gaming_flags for the 4 deterministic
-- rules (self-approval is already hard-blocked at Phase 4 — not scanned). Fixtures are
-- built inline in Org C (ceres). `now()` is constant within a transaction, so task
-- created_at values are set EXPLICITLY; the period-end-spike scenario uses a PAST period
-- (350) so the seed's now()-time approvals do not contaminate the window.
-- =============================================================================
begin;
select no_plan();

-- ---- helpers (Org C; rolled back with the test) -------------------------------------
-- Draft task with an explicit created_at (for the duplicate / tiny-split rules).
create function _ag_task(p_task uuid, p_assignee uuid, p_bp int, p_title text, p_created timestamptz)
returns void language plpgsql as $$
begin
  insert into public.tasks
    (id, organization_id, team_id, title, created_by, assigned_to, complexity, impact, base_points,
     scoring_policy_version_id, created_at)
  values
    (p_task, 'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000fc', p_title,
     'c0000000-0000-0000-0000-0000000000c3', p_assignee, 'low', 'low', p_bp,
     'c0000000-0000-0000-0000-0000000000d2', p_created);
end $$;

-- Create + approve a task for p_assignee, reviewed by c5 (the fc manager) — real flow, so
-- scoring writes a point_ledger row (for same_reviewer_concentration).
create function _ag_approve(p_task uuid, p_assignee uuid, p_title text)
returns void language plpgsql as $$
begin
  insert into public.tasks
    (id, organization_id, team_id, title, created_by, assigned_to, complexity, impact, base_points,
     scoring_policy_version_id)
  values
    (p_task, 'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000fc', p_title,
     'c0000000-0000-0000-0000-0000000000c3', p_assignee, 'low', 'low', 10,
     'c0000000-0000-0000-0000-0000000000d2');
  update public.tasks set status='assigned'    where id=p_task;
  update public.tasks set status='in_progress' where id=p_task;
  update public.tasks set status='submitted'   where id=p_task;
  perform set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c5"}', true);
  insert into public.task_reviews (id, organization_id, task_id, reviewer_id, decision, quality, timeliness)
    values (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000003', p_task,
            'c0000000-0000-0000-0000-0000000000c5', 'approve', 'good', 'on_time');
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Backdated task_approved point_ledger row (for period-end-spike; created_at is the time axis).
create function _ag_pl(p_task uuid, p_emp uuid, p_pts int, p_created timestamptz)
returns void language plpgsql as $$
begin
  insert into public.point_ledger
    (organization_id, employee_id, task_id, event_type, points_delta, reason, scoring_policy_version_id, created_by, created_at)
  values
    ('c0000000-0000-0000-0000-000000000003', p_emp, p_task, 'task_approved', p_pts, 'spike-fixture',
     'c0000000-0000-0000-0000-0000000000d2', 'c0000000-0000-0000-0000-0000000000c3', p_created);
end $$;

-- =============================================================================
-- SECTION A — privileged (build fixtures; run the scan; assert flags)
-- =============================================================================

-- (#1) Orchestrator exists.
select has_function('public', 'run_anti_gaming_scan', 'run_anti_gaming_scan exists');

-- Fixtures — duplicate_task (205): 301 earlier, 302 later same title (within 24h) -> flag 302;
-- 303 unique title -> no flag.
select _ag_task('a0000000-0000-0000-0000-000000000301','a0000000-0000-0000-0000-000000000205',7,'Report X', now()-interval '1 hour');
select _ag_task('a0000000-0000-0000-0000-000000000302','a0000000-0000-0000-0000-000000000205',7,'Report X', now());
select _ag_task('a0000000-0000-0000-0000-000000000303','a0000000-0000-0000-0000-000000000205',7,'Unique Y', now());

-- Fixtures — tiny_task_splitting (204): 3 tiny (<5) within 1h -> the 3rd triggers; control 203 has only 2.
select _ag_task('a0000000-0000-0000-0000-000000000310','a0000000-0000-0000-0000-000000000204',2,'tiny a', now()-interval '30 minutes');
select _ag_task('a0000000-0000-0000-0000-000000000311','a0000000-0000-0000-0000-000000000204',2,'tiny b', now()-interval '20 minutes');
select _ag_task('a0000000-0000-0000-0000-000000000312','a0000000-0000-0000-0000-000000000204',2,'tiny c', now()-interval '10 minutes');
select _ag_task('a0000000-0000-0000-0000-000000000320','a0000000-0000-0000-0000-000000000203',2,'tiny d', now()-interval '30 minutes');
select _ag_task('a0000000-0000-0000-0000-000000000321','a0000000-0000-0000-0000-000000000203',2,'tiny e', now()-interval '20 minutes');

-- Fixtures — same_reviewer_concentration (period 230): +2 approvals for 201 (seed gives 1) all by c5 -> total 3 -> flag.
select _ag_approve('a0000000-0000-0000-0000-000000000330','a0000000-0000-0000-0000-000000000201','sr one');
select _ag_approve('a0000000-0000-0000-0000-000000000331','a0000000-0000-0000-0000-000000000201','sr two');

-- Fixtures — period_end_spike on a PAST period 350 (excludes now() seed rows). Spike 201, control 202.
insert into public.bonus_periods (id, organization_id, period_type, starts_on, ends_on, status, created_by)
  values ('a0000000-0000-0000-0000-000000000350','c0000000-0000-0000-0000-000000000003','monthly',
          (now()-interval '30 days')::date,(now()-interval '5 days')::date,'open','c0000000-0000-0000-0000-0000000000c3');
select _ag_task('a0000000-0000-0000-0000-000000000340','a0000000-0000-0000-0000-000000000201',10,'spk a', now()-interval '25 days');
select _ag_task('a0000000-0000-0000-0000-000000000341','a0000000-0000-0000-0000-000000000201',10,'spk b', now()-interval '6 days');
select _ag_task('a0000000-0000-0000-0000-000000000342','a0000000-0000-0000-0000-000000000202',10,'spk c', now()-interval '25 days');
select _ag_task('a0000000-0000-0000-0000-000000000343','a0000000-0000-0000-0000-000000000202',10,'spk d', now()-interval '6 days');
select _ag_pl('a0000000-0000-0000-0000-000000000340','a0000000-0000-0000-0000-000000000201',100, now()-interval '25 days');  -- 201 early small
select _ag_pl('a0000000-0000-0000-0000-000000000341','a0000000-0000-0000-0000-000000000201',1000,now()-interval '6 days');   -- 201 late spike
select _ag_pl('a0000000-0000-0000-0000-000000000342','a0000000-0000-0000-0000-000000000202',3000,now()-interval '25 days');  -- 202 early big
select _ag_pl('a0000000-0000-0000-0000-000000000343','a0000000-0000-0000-0000-000000000202',100, now()-interval '6 days');   -- 202 late small

-- D5 baseline: capture ledger counts BEFORE the scan (the scan must not touch them).
create temp table _ag_d5 as
  select (select count(*) from public.point_ledger) as pl,
         (select count(*) from public.bonus_ledger) as bl;

-- (#2) Run the scan (period 230 for same_reviewer; task-scoped rules run org-wide).
select ok(public.run_anti_gaming_scan('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230') >= 3,
  'scan(period 230) inserts flags (duplicate + tiny + same_reviewer)');
-- (#3) Run the scan for the past period 350 (period_end_spike).
select ok(public.run_anti_gaming_scan('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000350') >= 1,
  'scan(period 350) inserts the period_end_spike flag');

-- (#4) duplicate_task: 302 (later) flagged; 301 (earlier) and 303 (unique) not.
select is((select count(*) from public.anti_gaming_flags where organization_id='c0000000-0000-0000-0000-000000000003' and rule='duplicate_task' and related_task_id='a0000000-0000-0000-0000-000000000302'),
  1::bigint, 'duplicate_task flags the later duplicate (302)');
select is((select count(*) from public.anti_gaming_flags where organization_id='c0000000-0000-0000-0000-000000000003' and rule='duplicate_task' and related_task_id='a0000000-0000-0000-0000-000000000301'),
  0::bigint, 'duplicate_task does not flag the earlier original (301)');
select is((select count(*) from public.anti_gaming_flags where organization_id='c0000000-0000-0000-0000-000000000003' and rule='duplicate_task' and related_task_id='a0000000-0000-0000-0000-000000000303'),
  0::bigint, 'duplicate_task does not flag a unique-title task (303)');

-- (#5) tiny_task_splitting: 204 flagged (>=1); control 203 not.
select ok((select count(*) from public.anti_gaming_flags where organization_id='c0000000-0000-0000-0000-000000000003' and rule='tiny_task_splitting' and subject_employee_id='a0000000-0000-0000-0000-000000000204') >= 1,
  'tiny_task_splitting flags 204 (>=3 tiny tasks in 1h)');
select is((select count(*) from public.anti_gaming_flags where organization_id='c0000000-0000-0000-0000-000000000003' and rule='tiny_task_splitting' and subject_employee_id='a0000000-0000-0000-0000-000000000203'),
  0::bigint, 'tiny_task_splitting does not flag 203 (only 2 tiny tasks)');

-- (#6) same_reviewer_concentration (period 230): 201 flagged; 202 not.
select is((select count(*) from public.anti_gaming_flags where organization_id='c0000000-0000-0000-0000-000000000003' and rule='same_reviewer_concentration' and subject_employee_id='a0000000-0000-0000-0000-000000000201' and bonus_period_id='a0000000-0000-0000-0000-000000000230'),
  1::bigint, 'same_reviewer_concentration flags 201 (3 approvals all by c5)');
select is((select count(*) from public.anti_gaming_flags where organization_id='c0000000-0000-0000-0000-000000000003' and rule='same_reviewer_concentration' and subject_employee_id='a0000000-0000-0000-0000-000000000202' and bonus_period_id='a0000000-0000-0000-0000-000000000230'),
  0::bigint, 'same_reviewer_concentration does not flag 202 (below MIN)');

-- (#7) period_end_spike (period 350): 201 flagged; 202 not.
select is((select count(*) from public.anti_gaming_flags where organization_id='c0000000-0000-0000-0000-000000000003' and rule='period_end_spike' and subject_employee_id='a0000000-0000-0000-0000-000000000201' and bonus_period_id='a0000000-0000-0000-0000-000000000350'),
  1::bigint, 'period_end_spike flags 201 (last-3-days > 3x daily avg)');
select is((select count(*) from public.anti_gaming_flags where organization_id='c0000000-0000-0000-0000-000000000003' and rule='period_end_spike' and subject_employee_id='a0000000-0000-0000-0000-000000000202' and bonus_period_id='a0000000-0000-0000-0000-000000000350'),
  0::bigint, 'period_end_spike does not flag 202 (early-loaded, no spike)');

-- (#8) D5 — the scan produced NO financial side effect (point_ledger / bonus_ledger unchanged).
select is((select count(*) from public.point_ledger), (select pl from _ag_d5),
  'D5: the scan adds NO point_ledger rows');
select is((select count(*) from public.bonus_ledger), (select bl from _ag_d5),
  'D5: the scan adds NO bonus_ledger rows');

-- (#9) Idempotency — re-running the scans adds no new flags.
create temp table _ag_cnt as select count(*) as n from public.anti_gaming_flags where organization_id='c0000000-0000-0000-0000-000000000003';
select is(public.run_anti_gaming_scan('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230'), 0,
  'idempotent: re-scan(230) inserts 0 new flags');
select is(public.run_anti_gaming_scan('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000350'), 0,
  'idempotent: re-scan(350) inserts 0 new flags');
select is((select count(*) from public.anti_gaming_flags where organization_id='c0000000-0000-0000-0000-000000000003'),
  (select n from _ag_cnt), 'idempotent: flag count unchanged after re-scan');

-- (#10) Permission catalog unchanged (scan is server/HR — no new permission).
select is((select count(*) from public.permissions), 20::bigint, 'permission catalog unchanged (20)');

-- =============================================================================
-- SECTION B — RLS as authenticated users (authorization surface)
-- =============================================================================
set local role authenticated;

-- (#11) A non-HR employee cannot run the scan (HR-only authz).
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000201"}', true);
select throws_ok(
  $$ select public.run_anti_gaming_scan('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230') $$,
  '42501', NULL, 'a non-HR employee cannot run the anti-gaming scan');

-- (#12) HR can run the scan (idempotent — already scanned).
select set_config('request.jwt.claims','{"sub":"c0000000-0000-0000-0000-0000000000c3"}', true);
select lives_ok(
  $$ select public.run_anti_gaming_scan('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000230') $$,
  'HR can run the anti-gaming scan');

-- (#13) The detect_* helpers are NOT callable by authenticated (server-only; no execute grant).
select throws_ok(
  $$ select public.detect_duplicate_task('c0000000-0000-0000-0000-000000000003') $$,
  '42501', NULL, 'detect_duplicate_task not executable by authenticated (server-only)');

-- (#14) Direct flag INSERT by authenticated is denied (server-only — 0016 posture holds).
select throws_ok(
  $$ insert into public.anti_gaming_flags (organization_id, rule, subject_employee_id)
     values ('c0000000-0000-0000-0000-000000000003','duplicate_task','a0000000-0000-0000-0000-000000000201') $$,
  '42501', 'permission denied for table anti_gaming_flags',
  'authenticated cannot INSERT a flag directly (server-only)');

reset role;
select * from finish();
rollback;
