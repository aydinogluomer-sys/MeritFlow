-- =============================================================================
-- pgTAP — ENGINEERING-00.5 FEATURE-GAP blocking suite: create_organization bootstrap
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 0036 (create_organization bootstrap + owner task.create/task.assign),
--       0004 (teams/team_memberships), 0006 (manages_team), 0008 (scoring policy versions),
--       0019 (tasks INSERT RLS + lifecycle), 0011 (bonus periods/pools INSERT RLS),
--       Decision Lock AD1/AD7/AD9/SI-7.
--
-- Whole file in a rolled-back transaction; seed assumed present. Two fresh callers with
-- real auth.users rows (profiles.id FKs auth.users): U1 bootstraps org A', U2 bootstraps
-- org B'. After create_organization each is the OWNER of a golden-path-ready org. Section
-- A is privileged (bypassrls) to assert the created rows; Section B runs as authenticated
-- to prove manages_team + RLS task INSERT + cross-tenant rejection + period/pool gating.
-- request.jwt.claims stamps auth.uid(); throws_ok uses the errcode form.
-- =============================================================================
begin;
select plan(14);

-- Two fresh callers (mirror seed's minimal auth.users insert shape).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-000000000000',
   '0c0c0c0c-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated',
   'fg-u1@meritflow.test', extensions.crypt('password123', extensions.gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '0c0c0c0c-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated',
   'fg-u2@meritflow.test', extensions.crypt('password123', extensions.gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

-- ---------------------------------------------------------------------------
-- Bootstrap: U1 -> org A' (fg-a), U2 -> org B' (fg-b). Each becomes owner.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"0c0c0c0c-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select public.create_organization('FG Org A', 'fg-a', 'FG Owner A') as org_a \gset

select set_config('request.jwt.claims', '{"sub":"0c0c0c0c-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select public.create_organization('FG Org B', 'fg-b', 'FG Owner B') as org_b \gset

-- =============================================================================
-- SECTION A — privileged assertions on the bootstrapped rows
-- =============================================================================

-- (#1) Owner role got task.create + task.assign (0036).
select is(
  (select count(*) from public.role_permissions
    where role_key = 'owner' and permission_key in ('task.create', 'task.assign')),
  2::bigint,
  'owner has task.create + task.assign (0036)'
);

-- (#2) Default team 'Genel' EXISTS in org A', manager = owner U1.
select ok(
  exists (
    select 1 from public.teams t
    where t.organization_id = :'org_a' and t.name = 'Genel'
      and t.manager_id = '0c0c0c0c-0000-0000-0000-0000000000c1'
  ),
  'default team Genel exists in org A with owner as manager'
);

-- (#3) Owner has a PRIMARY team_membership in the default team (AD9).
select ok(
  exists (
    select 1 from public.team_memberships tm
    join public.teams t on t.id = tm.team_id
    where t.organization_id = :'org_a' and t.name = 'Genel'
      and tm.profile_id = '0c0c0c0c-0000-0000-0000-0000000000c1'
      and tm.is_primary = true
  ),
  'owner has a primary team_membership in the default team (AD9)'
);

-- (#4) A PUBLISHED scoring_policy_version EXISTS for org A' (AD7 — scoring needs published).
select ok(
  exists (
    select 1 from public.scoring_policy_versions spv
    where spv.organization_id = :'org_a' and spv.status = 'published'
  ),
  'a published scoring_policy_version exists for the bootstrapped org (AD7)'
);

-- (#5) org.bootstrap audit row written.
select ok(
  exists (
    select 1 from public.audit_logs al
    where al.organization_id = :'org_a' and al.action = 'org.bootstrap'
      and al.actor_id = '0c0c0c0c-0000-0000-0000-0000000000c1'
  ),
  'org.bootstrap audit row written'
);

-- =============================================================================
-- SECTION B — RLS as authenticated (manages_team + task INSERT + cross-tenant + gating)
-- =============================================================================
set local role authenticated;

-- (#6) Owner U1 manages the default team via manages_team (current_org resolves to org A').
select set_config('request.jwt.claims', '{"sub":"0c0c0c0c-0000-0000-0000-0000000000c1"}', true);
select ok(
  (select public.manages_team(t.id) from public.teams t
    where t.organization_id = :'org_a' and t.name = 'Genel'),
  'owner manages the default team via manages_team()'
);

-- Capture ids the RLS INSERT will use (published version + default team).
reset role;
select id as pv_a from public.scoring_policy_versions
  where organization_id = :'org_a' and status = 'published' limit 1 \gset
select id as team_a from public.teams
  where organization_id = :'org_a' and name = 'Genel' limit 1 \gset
set local role authenticated;

-- (#7) Owner (task.create + own-team manager) can INSERT a task into the default team via RLS.
select set_config('request.jwt.claims', '{"sub":"0c0c0c0c-0000-0000-0000-0000000000c1"}', true);
select lives_ok(
  format(
    $$ insert into public.tasks
         (organization_id, team_id, title, status, created_by, assigned_to,
          complexity, impact, base_points, scoring_policy_version_id)
       values (%L, %L, 'fg-task', 'assigned', %L, %L, 'medium', 'high', 10, %L) $$,
    :'org_a', :'team_a',
    '0c0c0c0c-0000-0000-0000-0000000000c1', '0c0c0c0c-0000-0000-0000-0000000000c1', :'pv_a'
  ),
  'owner (task.create + own-team) can INSERT a task into the default team via RLS'
);

-- (#8) CROSS-TENANT (BLOCKING, SI-7): org-B owner U2 CANNOT insert a task into org A'.
select set_config('request.jwt.claims', '{"sub":"0c0c0c0c-0000-0000-0000-0000000000c2"}', true);
select throws_ok(
  format(
    $$ insert into public.tasks
         (organization_id, team_id, title, status, created_by, assigned_to,
          complexity, impact, base_points, scoring_policy_version_id)
       values (%L, %L, 'evil', 'assigned', %L, %L, 'low', 'low', 1, %L) $$,
    :'org_a', :'team_a',
    '0c0c0c0c-0000-0000-0000-0000000000c2', '0c0c0c0c-0000-0000-0000-0000000000c2', :'pv_a'
  ),
  '42501', 'new row violates row-level security policy for table "tasks"',
  'cross-tenant: org-B owner cannot INSERT a task into org A (SI-7, BLOCKING)'
);

-- (#9) period.manage gate: owner U1 (has period.manage) CAN insert a bonus period into org A'.
select set_config('request.jwt.claims', '{"sub":"0c0c0c0c-0000-0000-0000-0000000000c1"}', true);
select lives_ok(
  format(
    $$ insert into public.bonus_periods
         (organization_id, period_type, starts_on, ends_on, created_by)
       values (%L, 'monthly', date '2026-07-01', date '2026-07-31', %L) $$,
    :'org_a', '0c0c0c0c-0000-0000-0000-0000000000c1'
  ),
  'owner (period.manage) can INSERT a bonus period (gate satisfied)'
);

-- Capture the just-created period id (privileged read).
reset role;
select id as period_a from public.bonus_periods
  where organization_id = :'org_a' and starts_on = date '2026-07-01' limit 1 \gset
set local role authenticated;

-- (#10) pool.create gate: owner U1 (NO pool.create) CANNOT insert a bonus pool.
select set_config('request.jwt.claims', '{"sub":"0c0c0c0c-0000-0000-0000-0000000000c1"}', true);
select throws_ok(
  format(
    $$ insert into public.bonus_pools
         (organization_id, bonus_period_id, amount_minor, currency, created_by)
       values (%L, %L, 10000000, 'TRY', %L) $$,
    :'org_a', :'period_a', '0c0c0c0c-0000-0000-0000-0000000000c1'
  ),
  '42501', 'new row violates row-level security policy for table "bonus_pools"',
  'pool.create gate: owner (no pool.create) cannot INSERT a bonus pool'
);

-- (#11) period.manage gate: org-B owner U2 CANNOT insert a period into org A' (cross-tenant + gate).
select set_config('request.jwt.claims', '{"sub":"0c0c0c0c-0000-0000-0000-0000000000c2"}', true);
select throws_ok(
  format(
    $$ insert into public.bonus_periods
         (organization_id, period_type, starts_on, ends_on, created_by)
       values (%L, 'monthly', date '2026-08-01', date '2026-08-31', %L) $$,
    :'org_a', '0c0c0c0c-0000-0000-0000-0000000000c2'
  ),
  '42501', 'new row violates row-level security policy for table "bonus_periods"',
  'cross-tenant: org-B owner cannot INSERT a bonus period into org A'
);

-- (#12) pool.create ALLOW branch (mirror of #10's deny): in SEED org A, HR-A (period.manage)
--       creates a NEW period with no pool yet, then Finance-A (pool.create) inserts its pool.
--       (Seed periods already carry an active pool — the one-active-pool-per-period unique
--       index would mask the gate — so a fresh period is used.)
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
insert into public.bonus_periods
  (id, organization_id, period_type, starts_on, ends_on, created_by)
values ('a0000000-0000-0000-0000-0000000000ee', 'a0000000-0000-0000-0000-000000000001',
        'monthly', date '2026-09-01', date '2026-09-30',
        'a0000000-0000-0000-0000-0000000000a3');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select lives_ok(
  $$ insert into public.bonus_pools
       (organization_id, bonus_period_id, amount_minor, currency, created_by)
     values ('a0000000-0000-0000-0000-000000000001',
             'a0000000-0000-0000-0000-0000000000ee', 2500000, 'TRY',
             'a0000000-0000-0000-0000-0000000000a4') $$,
  'pool.create gate: Finance (has pool.create) can INSERT a bonus pool for a fresh period'
);

-- =============================================================================
-- SECTION C — GOLDEN-PATH SCORING (#13-#14): the DEFAULT published policy from
--   create_organization's bootstrap actually SCORES end-to-end. On the fresh org A',
--   approving a task writes a point_ledger task_approved row with final_points > 0.
--   Mechanism copied verbatim from 0019 (task lifecycle + review-driven approve) and
--   0020 (score_task_on_approve → point_ledger). Known inputs against the bootstrap
--   policy (0036): base 10 · complexity medium 1.25 · impact high 1.5 · quality good 1.0
--   · timeliness on_time 1.0 · revision_count 0 (penalty 0) = 18.75 (D: no DB rounding).
-- Self-approval hard block (AD4) + reviewer needs task.review (owner lacks it, 0035):
--   submitter = owner U1; reviewer = a fresh 'manager' profile that we make the default
--   team's manager_id so manages_team() is TRUE and its role grants task.review.
-- =============================================================================
reset role;

-- Fresh reviewer identity (real auth.users row; profiles.id FKs auth.users).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-000000000000',
   '0c0c0c0c-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated',
   'fg-mgr@meritflow.test', extensions.crypt('password123', extensions.gen_salt('bf')),
   now(), now(), now(), '', '', '', '');
insert into public.profiles (id, display_name)
values ('0c0c0c0c-0000-0000-0000-0000000000c3', 'FG Manager A');
-- Manager membership in org A' (primary_role 'manager' → grants task.review via 0035).
insert into public.memberships (organization_id, profile_id, primary_role, status)
values (:'org_a', '0c0c0c0c-0000-0000-0000-0000000000c3', 'manager', 'active');
-- Make the manager the default team's manager_id so manages_team() is TRUE for them.
update public.teams set manager_id = '0c0c0c0c-0000-0000-0000-0000000000c3'
  where id = :'team_a';

-- Golden-path task in the default team on the bootstrap PUBLISHED policy version.
-- Assignee/submitter = owner U1 (member of org A'); reviewer ≠ submitter (AD4).
-- Seeded + walked to 'submitted' in the trusted context (RLS/review guards N/A here).
-- Stamp auth.uid() as owner U1 so log_task_event's actor_id FK (task_events_actor_org_fk)
-- resolves to a member of org A' (a stale seed-org claim would violate that FK).
select set_config('request.jwt.claims', '{"sub":"0c0c0c0c-0000-0000-0000-0000000000c1"}', true);
insert into public.tasks
  (id, organization_id, team_id, title, status, created_by, assigned_to,
   complexity, impact, base_points, revision_count, scoring_policy_version_id)
values ('0c0c0c0c-0000-0000-0000-00000000ba01', :'org_a', :'team_a', 'fg-golden',
        'assigned', '0c0c0c0c-0000-0000-0000-0000000000c1',
        '0c0c0c0c-0000-0000-0000-0000000000c1', 'medium', 'high', 10, 0, :'pv_a');
update public.tasks set status='in_progress' where id='0c0c0c0c-0000-0000-0000-00000000ba01';
update public.tasks set status='submitted'   where id='0c0c0c0c-0000-0000-0000-00000000ba01';

-- Review-driven approve as the manager (task.review + manages_team + reviewer<>assignee).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c0c0c0c-0000-0000-0000-0000000000c3"}', true);
insert into public.task_reviews
  (organization_id, task_id, reviewer_id, decision, quality, timeliness)
values (:'org_a', '0c0c0c0c-0000-0000-0000-00000000ba01',
        '0c0c0c0c-0000-0000-0000-0000000000c3', 'approve', 'good', 'on_time');
reset role;

-- (#13) Golden-path guarantee: exactly one task_approved earning row with final_points > 0.
select ok(
  exists (
    select 1 from public.point_ledger pl
    where pl.task_id = '0c0c0c0c-0000-0000-0000-00000000ba01'
      and pl.event_type = 'task_approved'
      and pl.points_delta > 0
  ),
  'bootstrap default policy scores end-to-end: approve wrote a task_approved point_ledger row with final_points > 0'
);

-- (#14) Deterministic value from the bootstrap policy multipliers (10·1.25·1.5·1·1·(1-0)).
select is(
  (select points_delta from public.point_ledger
    where task_id = '0c0c0c0c-0000-0000-0000-00000000ba01' and event_type = 'task_approved'),
  18.75,
  'final_points = 18.75 via the default bootstrap policy (medium 1.25 · high 1.5 · good 1.0 · on_time 1.0)'
);

reset role;
select * from finish();
rollback;
