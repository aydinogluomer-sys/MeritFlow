-- =============================================================================
-- pgTAP — Phase P4 / slice 8-A2 (+ 8-B3): END-TO-END GOLDEN for the deterministic metric layer (Module 8).
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: §10.4 (finance money-delta), §10.6 (cap — HR/policy audience), §10.11 (semantic query service),
--   §10.21 (tests), §26, SI-12.
-- Proves: for a SELF-CONTAINED golden org, each executable metric's LOCKED formula (replicated in SQL)
--   yields the exact value over the real tables/views via the RLS read path; the SI-12 finance
--   isolation (Finance reads v_finance_* aggregates but 0 raw bonus_allocations/point_ledger rows —
--   the DB fact cap_hit_rate's role-reject rests on); employee self-only; and cross-tenant isolation.
-- 8-B3: the 0050 money-delta views (v_finance_cap_impact / v_finance_team_cost / v_finance_cost_per_employee)
--   are proven BOTH directions — authorized Finance reads the exact reconciling aggregate (no under-expose);
--   a non-authorized manager AND a cross-tenant Org-A actor each read 0 rows (no over-expose / no leak).
--
-- Isolation: a FRESH org d0000000-…-000000000004 (no collision with seeded a0..1/b0..2/c0..3 → the
--   metric aggregates are exactly the hardcoded fixtures, deterministic). The shared seed is UNTOUCHED
--   (the 2-B lesson) so 0041/0047/0048 exact-count tests are unaffected. Everything is created inside
--   this file's BEGIN…ROLLBACK. Fixtures are inserted under session_replication_role='replica' — the
--   standard test technique to bypass the non-deferred state-machine / FK triggers (period/pool lock,
--   run AD10, allocation freeze+AD9, task/flag/dispute state machines) and seed TERMINAL states
--   directly; CHECK constraints and RLS still apply, so the data is valid and the reads are real.
-- Actors (fresh): d1 hr, d2 auditor, d3 finance, d4 manager(team f1), d5/d6 employees (primary f1).
-- =============================================================================
begin;
select no_plan();

-- permission catalog unchanged (8-A2 adds no permission).
select is((select count(*) from public.permissions), 23::bigint, 'permission catalog unchanged at 23');

-- ---- fixtures: seed the fresh golden org (triggers/FK off; CHECK + RLS still enforced) -------------
-- session_replication_role='replica' skips user triggers AND FK RI system triggers (the standard
-- pg_restore --disable-triggers technique), letting us seed terminal states out of dependency order.
-- We STILL seed the identity graph (auth.users → profiles → memberships) in correct order so the
-- fixture is valid even if a runner enforces FKs — belt-and-suspenders for an un-runnable-locally test.
set local session_replication_role = 'replica';

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
   confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'd1@golden-d.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated', 'd2@golden-d.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-0000000000d3', 'authenticated', 'authenticated', 'd3@golden-d.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-0000000000d4', 'authenticated', 'authenticated', 'd4@golden-d.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-0000000000d5', 'authenticated', 'authenticated', 'd5@golden-d.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-0000000000d6', 'authenticated', 'authenticated', 'd6@golden-d.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(), now(), now(), '', '', '', '');

insert into public.profiles (id, display_name, alias) values
  ('d0000000-0000-0000-0000-0000000000d1', 'HR D1', 'hr-d1'),
  ('d0000000-0000-0000-0000-0000000000d2', 'Auditor D2', 'auditor-d2'),
  ('d0000000-0000-0000-0000-0000000000d3', 'Finance D3', 'finance-d3'),
  ('d0000000-0000-0000-0000-0000000000d4', 'Manager D4', 'manager-d4'),
  ('d0000000-0000-0000-0000-0000000000d5', 'Employee D5', 'employee-d5'),
  ('d0000000-0000-0000-0000-0000000000d6', 'Employee D6', 'employee-d6');

insert into public.organizations (id, name, slug)
values ('d0000000-0000-0000-0000-000000000004', 'Golden Org D', 'golden-org-d');

insert into public.memberships (organization_id, profile_id, primary_role) values
  ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d1', 'hr'),
  ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d2', 'auditor'),
  ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d3', 'finance'),
  ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d4', 'manager'),
  ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d5', 'employee'),
  ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d6', 'employee');

insert into public.teams (id, organization_id, name, manager_id)
values
  ('d0000000-0000-0000-0000-0000000000f1', 'd0000000-0000-0000-0000-000000000004', 'Golden Team', 'd0000000-0000-0000-0000-0000000000d4'),
  -- f2 exists ONLY to give d6 a LIVE primary team that DIFFERS from their frozen allocation team (f1),
  -- proving v_finance_team_cost attributes by the SNAPSHOT allocation team, not the live roster.
  ('d0000000-0000-0000-0000-0000000000f2', 'd0000000-0000-0000-0000-000000000004', 'Golden Team 2 (post-calc)', 'd0000000-0000-0000-0000-0000000000d4');

insert into public.team_memberships (organization_id, team_id, profile_id, role_in_team, is_primary) values
  ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000f1', 'd0000000-0000-0000-0000-0000000000d4', 'lead', true),
  ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000f1', 'd0000000-0000-0000-0000-0000000000d5', 'member', true),
  -- d6 was RE-TEAMED to f2 AFTER the period's bonus run — LIVE primary (f2) now differs from the FROZEN
  -- allocation snapshot team (f1). team_cost must still attribute d6's accrual to the SNAPSHOT team f1.
  ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000f2', 'd0000000-0000-0000-0000-0000000000d6', 'member', true);

-- scoring policy + version (draft — tasks/policy_complexity only need the FK target to exist).
insert into public.scoring_policies (id, organization_id, name, status, created_by)
values ('d0000000-0000-0000-0000-0000000000e1', 'd0000000-0000-0000-0000-000000000004', 'Golden Policy', 'active', 'd0000000-0000-0000-0000-0000000000d1');
insert into public.scoring_policy_versions
  (id, organization_id, scoring_policy_id, version_no, status, multipliers, revision_penalty_rule, timeliness_thresholds, created_by)
values ('d0000000-0000-0000-0000-0000000000e2', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000e1',
        1, 'draft', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'd0000000-0000-0000-0000-0000000000d1');

-- policy_complexity: total_score = 40.
insert into public.policy_complexity_evaluations
  (id, organization_id, policy_version_id, rule_set_version, static_score, total_score, components)
values ('d0000000-0000-0000-0000-0000000000e3', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000e2',
        'static-v1', 40, 40, '[]'::jsonb);

-- opportunity_snapshots: d5=60, d6=80 → mean 70.
insert into public.opportunity_snapshots
  (id, organization_id, employee_id, bonus_period_id, rule_set_version, eligible_work_count, assigned_work_count,
   completed_work_count, complexity_weighted_available, complexity_weighted_assigned, active_days, opportunity_index, components)
values
  ('d0000000-0000-0000-0000-000000000061', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d5',
   'd0000000-0000-0000-0000-0000000000fa', 'opportunity-v1', 10, 8, 6, 20, 16, 20, 60, '{"suppressed":false}'::jsonb),
  ('d0000000-0000-0000-0000-000000000062', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d6',
   'd0000000-0000-0000-0000-0000000000fa', 'opportunity-v1', 10, 9, 7, 20, 18, 20, 80, '{"suppressed":false}'::jsonb);

-- tasks: 3 approved (latency 2000/4000/6000 ms) + 1 rejected, all completed in the June window.
insert into public.tasks
  (id, organization_id, team_id, title, status, created_by, assigned_to, complexity, impact, base_points,
   scoring_policy_version_id, submitted_at, approved_at, completed_at)
values
  ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000f1',
   'T1', 'approved', 'd0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-0000000000d5', 'medium', 'high', 100,
   'd0000000-0000-0000-0000-0000000000e2', '2026-06-10T00:00:00Z', '2026-06-10T00:00:02Z', '2026-06-10T00:00:02Z'),
  ('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000f1',
   'T2', 'approved', 'd0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-0000000000d5', 'medium', 'high', 100,
   'd0000000-0000-0000-0000-0000000000e2', '2026-06-11T00:00:00Z', '2026-06-11T00:00:04Z', '2026-06-11T00:00:04Z'),
  ('d0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000f1',
   'T3', 'approved', 'd0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-0000000000d6', 'low', 'medium', 100,
   'd0000000-0000-0000-0000-0000000000e2', '2026-06-12T00:00:00Z', '2026-06-12T00:00:06Z', '2026-06-12T00:00:06Z'),
  ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000f1',
   'T4', 'rejected', 'd0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-0000000000d6', 'low', 'low', 100,
   'd0000000-0000-0000-0000-0000000000e2', '2026-06-13T00:00:00Z', null, '2026-06-13T00:00:00Z');

-- point_ledger: 3 task_approved (distinct employees d5,d6 → scored population = 2) + 1 manual_adjustment.
insert into public.point_ledger
  (id, organization_id, employee_id, event_type, points_delta, reason, created_by, task_id, scoring_policy_version_id, created_at)
values
  ('d0000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d5',
   'task_approved', 100, 'approved', 'd0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-0000000000e2', '2026-06-10T00:00:03Z'),
  ('d0000000-0000-0000-0000-000000000012', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d5',
   'task_approved', 100, 'approved', 'd0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-0000000000e2', '2026-06-11T00:00:05Z'),
  ('d0000000-0000-0000-0000-000000000013', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d6',
   'task_approved', 100, 'approved', 'd0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-000000000003',
   'd0000000-0000-0000-0000-0000000000e2', '2026-06-12T00:00:07Z'),
  ('d0000000-0000-0000-0000-000000000014', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d5',
   'manual_adjustment', 10, 'manual tweak', 'd0000000-0000-0000-0000-0000000000d1', null, null, '2026-06-15T00:00:00Z');

-- anti_gaming_flags: d5 confirmed (period fa), d6 dismissed → 1 distinct confirmed / population 2 = 50%.
insert into public.anti_gaming_flags
  (id, organization_id, rule, subject_employee_id, status, evidence, bonus_period_id, reviewed_by, review_note)
values
  ('d0000000-0000-0000-0000-000000000021', 'd0000000-0000-0000-0000-000000000004', 'duplicate_task',
   'd0000000-0000-0000-0000-0000000000d5', 'confirmed', '{}'::jsonb, 'd0000000-0000-0000-0000-0000000000fa',
   'd0000000-0000-0000-0000-0000000000d1', 'confirmed by hr'),
  ('d0000000-0000-0000-0000-000000000022', 'd0000000-0000-0000-0000-000000000004', 'period_end_spike',
   'd0000000-0000-0000-0000-0000000000d6', 'dismissed', '{}'::jsonb, 'd0000000-0000-0000-0000-0000000000fa',
   'd0000000-0000-0000-0000-0000000000d1', 'dismissed by hr');

-- disputes: 2 opened in the June window (one each type) → 2 / population 2 = 100% (per-type 50%).
insert into public.disputes
  (id, organization_id, complainant_id, dispute_type, target_type, target_id, status, opened_at)
values
  ('d0000000-0000-0000-0000-000000000031', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d5',
   'unfair_rejection', 'task', 'd0000000-0000-0000-0000-000000000004', 'open', '2026-06-14T00:00:00Z'),
  ('d0000000-0000-0000-0000-000000000032', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000d6',
   'system_error', 'task', 'd0000000-0000-0000-0000-000000000001', 'open', '2026-06-15T00:00:00Z');

-- bonus chain (locked period+pool, completed run, snapshot, allocations, balanced accrual ledger).
insert into public.bonus_periods (id, organization_id, period_type, starts_on, ends_on, status, created_by, locked_at, locked_by)
values ('d0000000-0000-0000-0000-0000000000fa', 'd0000000-0000-0000-0000-000000000004', 'monthly', '2026-06-01', '2026-06-30',
        'locked', 'd0000000-0000-0000-0000-0000000000d1', now(), 'd0000000-0000-0000-0000-0000000000d1');
insert into public.bonus_pools (id, organization_id, bonus_period_id, amount_minor, currency, status, created_by, t_org, locked_at, locked_by)
values ('d0000000-0000-0000-0000-0000000000fb', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000fa',
        8000000, 'TRY', 'locked', 'd0000000-0000-0000-0000-0000000000d3', 1, now(), 'd0000000-0000-0000-0000-0000000000d3');
insert into public.bonus_calculation_runs
  (id, organization_id, bonus_period_id, bonus_pool_id, status, idempotency_key, triggered_by, t_org, completed_at)
values ('d0000000-0000-0000-0000-0000000000fc', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000fa',
        'd0000000-0000-0000-0000-0000000000fb', 'completed', 'golden-run', 'd0000000-0000-0000-0000-0000000000d1', 1, now());
insert into public.bonus_allocation_snapshots
  (id, organization_id, calculation_run_id, bonus_period_id, bonus_pool_id, undistributed_remainder_minor, calculation_metadata)
values ('d0000000-0000-0000-0000-0000000000fd', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000fc',
        'd0000000-0000-0000-0000-0000000000fa', 'd0000000-0000-0000-0000-0000000000fb', 0, '{"distributable_minor":8000000}'::jsonb);
-- cap_hit_rate: d5 'yes' (final ≤ cap_minor), d6 'no' → 1 of 2 = 50%.
insert into public.bonus_allocations
  (id, organization_id, calculation_run_id, bonus_period_id, employee_id, primary_team_id,
   adjusted_score, raw_share_minor, final_amount_minor, cap_minor, cap_applied, status)
values
  -- d5 capped: pre-cap raw_share 7M, capped to final 6M (cap_minor 6M) → cap money impact = 1M (INV-4: final ≤ cap).
  ('d0000000-0000-0000-0000-000000000041', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000fc',
   'd0000000-0000-0000-0000-0000000000fa', 'd0000000-0000-0000-0000-0000000000d5', 'd0000000-0000-0000-0000-0000000000f1',
   1000, 7000000, 6000000, 6000000, 'yes', 'calculated'),
  ('d0000000-0000-0000-0000-000000000042', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000fc',
   'd0000000-0000-0000-0000-0000000000fa', 'd0000000-0000-0000-0000-0000000000d6', 'd0000000-0000-0000-0000-0000000000f1',
   1000, 4000000, 4000000, null, 'no', 'calculated');
-- balanced accrual ledger (one transaction): credit accrual d5 6M + d6 4M, debit pool 10M.
insert into public.bonus_ledger
  (id, organization_id, bonus_pool_id, employee_id, snapshot_id, transaction_id, entry_type, account, event_type, amount_minor, currency, created_by)
values
  ('d0000000-0000-0000-0000-000000000051', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000fb',
   'd0000000-0000-0000-0000-0000000000d5', 'd0000000-0000-0000-0000-0000000000fd', 'd0000000-0000-0000-0000-0000000000ee',
   'credit', 'accrual', 'bonus_accrual', 6000000, 'TRY', 'd0000000-0000-0000-0000-0000000000d3'),
  ('d0000000-0000-0000-0000-000000000052', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000fb',
   'd0000000-0000-0000-0000-0000000000d6', 'd0000000-0000-0000-0000-0000000000fd', 'd0000000-0000-0000-0000-0000000000ee',
   'credit', 'accrual', 'bonus_accrual', 4000000, 'TRY', 'd0000000-0000-0000-0000-0000000000d3'),
  ('d0000000-0000-0000-0000-000000000053', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000fb',
   null, 'd0000000-0000-0000-0000-0000000000fd', 'd0000000-0000-0000-0000-0000000000ee',
   'debit', 'pool', 'bonus_accrual', 10000000, 'TRY', 'd0000000-0000-0000-0000-0000000000d3');

set local session_replication_role = 'origin';

-- policy_complexity (audience = policy.manage; asserted RLS-agnostic here) = total_score 40.
select is((select total_score from public.policy_complexity_evaluations
           where organization_id = 'd0000000-0000-0000-0000-000000000004'
             and policy_version_id = 'd0000000-0000-0000-0000-0000000000e2'),
          40::numeric, 'policy_complexity = latest total_score (40)');

-- =============================================================================
-- Metric VALUE assertions via the real RLS read path — HR (d1), org-wide reader.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-0000000000d1"}', true);

-- cap_hit_rate = count(cap_applied='yes')/count(*) over the period's allocations = 50.
select is(
  (select round(count(*) filter (where cap_applied = 'yes')::numeric / count(*) * 100, 2)
   from public.bonus_allocations
   where organization_id = 'd0000000-0000-0000-0000-000000000004' and bonus_period_id = 'd0000000-0000-0000-0000-0000000000fa'),
  50.00, 'cap_hit_rate = 50% (1 of 2 capped) — HR reads bonus_allocations org-wide');

-- cycle_completion_rate = approved / terminal in the completed_at window = 75.
select is(
  (select round(count(*) filter (where status = 'approved')::numeric / count(*) * 100, 2)
   from public.tasks
   where organization_id = 'd0000000-0000-0000-0000-000000000004' and status in ('approved', 'rejected')
     and completed_at >= '2026-06-01' and completed_at < '2026-07-01'),
  75.00, 'cycle_completion_rate = 75% (3 approved of 4 terminal)');

-- approval_latency = median(approved_at − submitted_at) in ms = 4000.
select is(
  (select round(percentile_cont(0.5) within group (
            order by extract(epoch from (approved_at - submitted_at)) * 1000))::bigint
   from public.tasks
   where organization_id = 'd0000000-0000-0000-0000-000000000004' and status = 'approved'
     and submitted_at is not null and approved_at >= '2026-06-01' and approved_at < '2026-07-01'),
  4000::bigint, 'approval_latency = 4000 ms (median of 2000/4000/6000)');

-- manual_override_rate = manual / (task_approved + manual) in the window = 25.
select is(
  (select round(count(*) filter (where event_type = 'manual_adjustment')::numeric / count(*) * 100, 2)
   from public.point_ledger
   where organization_id = 'd0000000-0000-0000-0000-000000000004' and event_type in ('task_approved', 'manual_adjustment')
     and created_at >= '2026-06-01' and created_at < '2026-07-01'),
  25.00, 'manual_override_rate = 25% (1 manual of 4 scoring entries)');

-- gaming_flag_rate = distinct confirmed-flag employees (period) / distinct scored employees = 50.
select is(
  round(
    (select count(distinct subject_employee_id) from public.anti_gaming_flags
     where organization_id = 'd0000000-0000-0000-0000-000000000004' and status = 'confirmed'
       and bonus_period_id = 'd0000000-0000-0000-0000-0000000000fa')::numeric
    / (select count(distinct employee_id) from public.point_ledger
       where organization_id = 'd0000000-0000-0000-0000-000000000004' and event_type = 'task_approved'
         and created_at >= '2026-06-01' and created_at < '2026-07-01') * 100, 2),
  50.00, 'gaming_flag_rate = 50% (1 confirmed of 2 scored employees)');

-- opportunity_index = mean of non-null indices = 70.
select is(
  (select round(avg(opportunity_index), 2) from public.opportunity_snapshots
   where organization_id = 'd0000000-0000-0000-0000-000000000004' and bonus_period_id = 'd0000000-0000-0000-0000-0000000000fa'
     and opportunity_index is not null),
  70.00, 'opportunity_index = 70 (mean of 60, 80)');

-- dispute_rate = disputes-in-window / scored population = 100.
select is(
  round(
    (select count(*) from public.disputes
     where organization_id = 'd0000000-0000-0000-0000-000000000004'
       and opened_at >= '2026-06-01' and opened_at < '2026-07-01')::numeric
    / (select count(distinct employee_id) from public.point_ledger
       where organization_id = 'd0000000-0000-0000-0000-000000000004' and event_type = 'task_approved'
         and created_at >= '2026-06-01' and created_at < '2026-07-01') * 100, 2),
  100.00, 'dispute_rate = 100% (2 disputes over 2 scored employees)');

reset role;

-- =============================================================================
-- Finance (d3) — SI-12: reads v_finance_* aggregates, NEVER raw allocations/points.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-0000000000d3"}', true);

-- payout_total via v_finance_payout = Σ final_amount_minor = 10,000,000.
select is(
  (select sum(final_amount_minor) from public.v_finance_payout
   where bonus_period_id = 'd0000000-0000-0000-0000-0000000000fa'),
  10000000::numeric, 'payout_total = 10,000,000 minor (Finance via v_finance_payout)');

-- payout_concentration (HHI over the payout distribution) = 0.6² + 0.4² = 0.52.
select is(
  (with p as (select final_amount_minor::numeric as amt from public.v_finance_payout
              where bonus_period_id = 'd0000000-0000-0000-0000-0000000000fa' and final_amount_minor > 0),
        t as (select sum(amt) as s from p)
   select round(sum(power(amt / (select s from t), 2)), 4) from p),
  0.5200, 'payout_concentration HHI = 0.52 (0.6² + 0.4²)');

-- budget_variance via v_finance_period_totals = (10M − 8M)/8M·100 = 25.
select is(
  (select round((total_accrued - pool_amount)::numeric / pool_amount * 100, 2)
   from public.v_finance_period_totals where bonus_period_id = 'd0000000-0000-0000-0000-0000000000fa'),
  25.00, 'budget_variance = 25% (accrued 10M vs pool 8M)');

-- 8-B3 money-delta views (0050): definer-rights + self-gated to hr/finance/auditor. Finance is
-- AUTHORIZED here — the "no under-expose" direction: an authorized role reads the exact aggregate
-- (Finance is EXCLUDED from the raw bonus_allocations + memberships sources these views read, which is
-- the entire reason these SI-12-safe definer-rights views exist).
-- cap_money_impact = Σ(raw_share − final) FILTER cap_applied='yes' = (7M − 6M) = 1,000,000.
select is((select sum(cap_impact_minor) from public.v_finance_cap_impact),
          1000000::numeric, 'cap_money_impact = 1,000,000 (raw 7M capped to 6M; Finance via v_finance_cap_impact)');
-- team_cost = Σ net accrual per SNAPSHOT team (d5+d6 both allocated to team f1 = bonus_allocations
-- .primary_team_id) = 6M + 4M = 10,000,000, reconciling to payout_total (identical net-accrual formula).
select is((select team_cost_minor from public.v_finance_team_cost
           where team_id = 'd0000000-0000-0000-0000-0000000000f1'
             and bonus_period_id = 'd0000000-0000-0000-0000-0000000000fa'),
          10000000::bigint, 'team_cost[f1] = 10,000,000 (SNAPSHOT team; reconciles to payout_total)');
-- SNAPSHOT-attribution proof (AD9): d6's LIVE primary team is f2 (team_memberships) but the FROZEN
-- allocation snapshot team is f1 (bonus_allocations.primary_team_id). team_cost MUST attribute d6's 4M
-- accrual to the snapshot team f1 (already counted in the 10M above) — NOT the live team f2 → f2 has 0
-- rows. If the view attributed by the LIVE roster, f1 would be 6M and an f2=4M row would appear.
-- (This is the assertion that catches live-team drift on a closed period.)
select is((select count(*) from public.v_finance_team_cost
           where team_id = 'd0000000-0000-0000-0000-0000000000f2'),
          0::bigint, 'team_cost attributes by SNAPSHOT team (f1) — d6''s live team f2 gets 0 rows (no drift)');
-- cost_per_employee = total_accrued (10M) ÷ active headcount (6 active memberships) = 1,666,666 (floored);
-- headcount·cost_per_employee reconciles to total_accrued.
select is((select cost_per_employee_minor from public.v_finance_cost_per_employee
           where bonus_period_id = 'd0000000-0000-0000-0000-0000000000fa'),
          1666666::bigint, 'cost_per_employee = 1,666,666 (10M accrued / 6 active members)');
select is((select active_headcount from public.v_finance_cost_per_employee
           where bonus_period_id = 'd0000000-0000-0000-0000-0000000000fa'),
          6::bigint, 'cost_per_employee active_headcount = 6 (org d active memberships)');

-- SI-12: Finance is EXCLUDED from raw allocations + points (this is why cap_hit_rate rejects Finance).
select is((select count(*) from public.bonus_allocations
           where organization_id = 'd0000000-0000-0000-0000-000000000004'),
          0::bigint, 'SI-12: Finance sees 0 raw bonus_allocations rows (source-excluded)');
select is((select count(*) from public.point_ledger
           where organization_id = 'd0000000-0000-0000-0000-000000000004'),
          0::bigint, 'SI-12: Finance sees 0 raw point_ledger rows');

reset role;

-- =============================================================================
-- Employee (d5) — self-only visibility (no cross-employee leakage).
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-0000000000d5"}', true);
select is((select count(*) from public.point_ledger
           where organization_id = 'd0000000-0000-0000-0000-000000000004'
             and employee_id <> 'd0000000-0000-0000-0000-0000000000d5'),
          0::bigint, 'employee sees only OWN point_ledger rows (self-only)');
select is((select count(*) from public.opportunity_snapshots
           where id = 'd0000000-0000-0000-0000-000000000062'),
          0::bigint, 'employee cannot read another employee''s opportunity snapshot');
select is((select count(*) from public.opportunity_snapshots
           where id = 'd0000000-0000-0000-0000-000000000061'),
          1::bigint, 'employee reads their OWN opportunity snapshot');
reset role;

-- =============================================================================
-- Non-authorized role (d4 manager) — 8-B3 money-delta views self-gate to hr/finance/auditor. A manager
-- is NOT in that set → the definer view's WHERE role-gate returns 0 rows. This is the "no OVER-expose"
-- direction: a role that must not see aggregate money gets an empty read (→ metric_not_available_for_role
-- at the executor layer), never a leaked value. If this ever returns > 0, STOP and redesign as a
-- SECURITY DEFINER function with internal authz (do not paper over a failing negative).
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-0000000000d4"}', true);
select is((select count(*) from public.v_finance_cap_impact), 0::bigint,
          'no over-expose: a manager (non hr/finance/auditor) reads 0 rows from v_finance_cap_impact');
select is((select count(*) from public.v_finance_team_cost), 0::bigint,
          'no over-expose: a manager reads 0 rows from v_finance_team_cost');
select is((select count(*) from public.v_finance_cost_per_employee), 0::bigint,
          'no over-expose: a manager reads 0 rows from v_finance_cost_per_employee');
reset role;

-- =============================================================================
-- Cross-tenant — a SEEDED Org A actor (a3, HR) sees NONE of the golden org's rows.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.opportunity_snapshots
           where organization_id = 'd0000000-0000-0000-0000-000000000004'),
          0::bigint, 'cross-tenant: Org A HR sees 0 golden-org opportunity snapshots');
select is((select count(*) from public.bonus_allocations
           where organization_id = 'd0000000-0000-0000-0000-000000000004'),
          0::bigint, 'cross-tenant: Org A HR sees 0 golden-org allocations');
select is((select count(*) from public.disputes
           where organization_id = 'd0000000-0000-0000-0000-000000000004'),
          0::bigint, 'cross-tenant: Org A HR sees 0 golden-org disputes');
-- 8-B3: the money-delta views WHERE org = current_org() (= Org A for a3) → org d rows never leak, even
-- though a3 IS an authorized (HR) role. Proves org isolation is independent of the role self-gate.
select is((select count(*) from public.v_finance_cap_impact
           where organization_id = 'd0000000-0000-0000-0000-000000000004'), 0::bigint,
          'cross-tenant: Org A HR sees 0 golden-org rows from v_finance_cap_impact');
select is((select count(*) from public.v_finance_team_cost
           where organization_id = 'd0000000-0000-0000-0000-000000000004'), 0::bigint,
          'cross-tenant: Org A HR sees 0 golden-org rows from v_finance_team_cost');
select is((select count(*) from public.v_finance_cost_per_employee
           where organization_id = 'd0000000-0000-0000-0000-000000000004'), 0::bigint,
          'cross-tenant: Org A HR sees 0 golden-org rows from v_finance_cost_per_employee');
reset role;

select * from finish();
rollback;
