-- =============================================================================
-- Migration 0023 — anti-gaming detection engine  (Phase 7-A)
-- Refs: 08_ANTI_GAMING_MVP_SPEC (5 rules), 19_PHASE_7_... (locked OQ decisions),
--       0016 (anti_gaming_flags container), Decision Lock D5, ADR-020.
--
-- Scope (Phase 7-A ONLY): the deterministic DETECTION engine that produces flags into
-- the existing anti_gaming_flags container (0016). run_anti_gaming_scan() orchestrates 4
-- detect_* functions (self-approval is already hard-blocked at Phase 4 — not scanned).
-- All functions are SECURITY DEFINER + server-only. Idempotent via a dual partial-unique
-- index (OQ-2) + `where not exists` guards.
--
-- Locked decisions (doc 19):
--   OQ-1  thresholds are HARDCODED constants (organization_settings columns → V1).
--   OQ-2  dual idempotency key: task-scoped (org, rule, subject, related_task_id);
--         period-scoped (org, rule, subject, bonus_period_id) — two partial unique indexes.
--         Adds anti_gaming_flags.bonus_period_id as an FK-LESS column (mirrors the FK-less
--         related_task_id) so D5 isolation "no FK to bonus_* tables" is preserved.
--   OQ-3  detection runs ONLY via an explicit run_anti_gaming_scan() call (HR/job) — never
--         automatic at approve-time.
--   OQ-7  self_approval_attempt trail deferred to V1.
--
-- D5 ISOLATION PRESERVED: the detect functions READ tasks / task_reviews / point_ledger /
-- bonus_periods and WRITE ONLY anti_gaming_flags — no write path/FK/trigger to point_ledger
-- / bonus_ledger / compensation_records / bonus_* value tables. A confirmed flag still has
-- no financial side effect (0016 guarantees + 0010 test unchanged).
--
-- DELIBERATELY ABSENT (gated): any write to point_ledger/bonus_ledger; dispute wiring
-- (7-B/7-C); organization_settings threshold columns; self_approval_attempt trail;
-- app/UI/API. No new permission (catalog stays 20). No edits to 0001..0022 / existing
-- tests. Local dev/staging only (ADR-014).
-- =============================================================================

-- OQ-2: FK-less period column (only for the period-scoped idempotency key; no FK → D5
-- isolation "no FK to bonus_* tables" preserved). Set by the detect functions at INSERT;
-- server-only writes mean it is never client-mutated.
alter table public.anti_gaming_flags add column bonus_period_id uuid;

comment on column public.anti_gaming_flags.bonus_period_id is
  'Period-scoped flags carry the bonus_period_id (FK-LESS — D5 isolation). Idempotency key (OQ-2).';

-- Dual partial unique idempotency indexes (OQ-2).
create unique index uq_anti_gaming_flags_task_scoped
  on public.anti_gaming_flags (organization_id, rule, subject_employee_id, related_task_id)
  where rule in ('duplicate_task', 'tiny_task_splitting');

create unique index uq_anti_gaming_flags_period_scoped
  on public.anti_gaming_flags (organization_id, rule, subject_employee_id, bonus_period_id)
  where rule in ('period_end_spike', 'same_reviewer_concentration');

-- -----------------------------------------------------------------------------
-- Rule 2 — detect_duplicate_task: same assignee + same normalized title within 24h.
-- Flags the LATER task (related_task_id = the duplicate). Constant: window = 24h.
-- -----------------------------------------------------------------------------
create or replace function public.detect_duplicate_task(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  insert into public.anti_gaming_flags
    (organization_id, rule, subject_employee_id, related_task_id, evidence)
  select p_organization_id, 'duplicate_task', t.assigned_to, t.id,
         jsonb_build_object('title', lower(btrim(t.title)), 'window_hours', 24)
  from public.tasks t
  where t.organization_id = p_organization_id
    and exists (
      select 1 from public.tasks o
      where o.organization_id = t.organization_id
        and o.assigned_to = t.assigned_to
        and lower(btrim(o.title)) = lower(btrim(t.title))
        and o.id <> t.id
        and o.created_at < t.created_at
        and t.created_at - o.created_at <= interval '24 hours')
    and not exists (
      select 1 from public.anti_gaming_flags f
      where f.organization_id = p_organization_id and f.rule = 'duplicate_task'
        and f.subject_employee_id = t.assigned_to and f.related_task_id = t.id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rule 3 — detect_tiny_task_splitting: >= 3 low-base_point (<5) tasks by the same
-- assignee within a 1h window; flags each triggering task. Constants: base<5, M=3, 60m.
-- -----------------------------------------------------------------------------
create or replace function public.detect_tiny_task_splitting(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  insert into public.anti_gaming_flags
    (organization_id, rule, subject_employee_id, related_task_id, evidence)
  select p_organization_id, 'tiny_task_splitting', t.assigned_to, t.id,
         jsonb_build_object('base_points', t.base_points, 'window_minutes', 60,
                            'threshold_base', 5, 'min_count', 3)
  from public.tasks t
  where t.organization_id = p_organization_id
    and t.base_points < 5
    and (
      select count(*) from public.tasks s
      where s.organization_id = t.organization_id
        and s.assigned_to = t.assigned_to
        and s.base_points < 5
        and s.created_at <= t.created_at
        and t.created_at - s.created_at <= interval '60 minutes'
    ) >= 3
    and not exists (
      select 1 from public.anti_gaming_flags f
      where f.organization_id = p_organization_id and f.rule = 'tiny_task_splitting'
        and f.subject_employee_id = t.assigned_to and f.related_task_id = t.id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rule 4 — detect_same_reviewer_concentration(period): among an employee's tasks
-- approved in the period, if one reviewer's share > 80% and total approvals >= 3, flag.
-- Constants: share > 0.80, MIN = 3. (Single-team employees naturally concentrate — the
-- human review judges; this is the MVP deterministic signal.)
-- -----------------------------------------------------------------------------
create or replace function public.detect_same_reviewer_concentration(
  p_organization_id uuid, p_bonus_period_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  insert into public.anti_gaming_flags
    (organization_id, rule, subject_employee_id, related_reviewer_id, bonus_period_id, evidence)
  with per as (
    select starts_on, ends_on from public.bonus_periods
    where id = p_bonus_period_id and organization_id = p_organization_id
  ),
  appr as (
    select t.assigned_to as employee_id, r.reviewer_id
    from public.tasks t
    join public.task_reviews r
      on r.task_id = t.id and r.organization_id = t.organization_id and r.decision = 'approve'
    cross join per
    where t.organization_id = p_organization_id
      and t.status = 'approved'
      and t.approved_at::date between per.starts_on and per.ends_on
  ),
  agg as (
    select employee_id, reviewer_id, count(*) as by_rev,
           sum(count(*)) over (partition by employee_id) as total
    from appr group by employee_id, reviewer_id
  )
  select p_organization_id, 'same_reviewer_concentration', a.employee_id, a.reviewer_id,
         p_bonus_period_id,
         jsonb_build_object('reviewer_id', a.reviewer_id, 'by_reviewer', a.by_rev,
                            'total', a.total, 'share', round(a.by_rev::numeric / a.total, 4),
                            'bonus_period_id', p_bonus_period_id)
  from agg a
  where a.total >= 3
    and a.by_rev::numeric / a.total > 0.80
    and not exists (
      select 1 from public.anti_gaming_flags f
      where f.organization_id = p_organization_id and f.rule = 'same_reviewer_concentration'
        and f.subject_employee_id = a.employee_id and f.bonus_period_id = p_bonus_period_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rule 5 — detect_period_end_spike(period): an employee's last-3-days approved-point
-- gain (point_ledger task_approved credited within the period, by created_at) exceeds
-- K× the period daily average. Constants: window = 3 days, K = 3.
-- -----------------------------------------------------------------------------
create or replace function public.detect_period_end_spike(
  p_organization_id uuid, p_bonus_period_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n      integer;
  v_starts date;
  v_ends   date;
  v_days   integer;
begin
  select starts_on, ends_on, (ends_on - starts_on + 1)
    into v_starts, v_ends, v_days
  from public.bonus_periods where id = p_bonus_period_id and organization_id = p_organization_id;
  if not found or v_days is null or v_days <= 0 then
    return 0;
  end if;

  insert into public.anti_gaming_flags
    (organization_id, rule, subject_employee_id, bonus_period_id, evidence)
  select p_organization_id, 'period_end_spike', p.employee_id, p_bonus_period_id,
         jsonb_build_object('total', p.total, 'last3', p.last3,
                            'daily_avg', round(p.total::numeric / v_days, 2), 'k', 3,
                            'bonus_period_id', p_bonus_period_id)
  from (
    select pl.employee_id,
           sum(pl.points_delta) as total,
           coalesce(sum(pl.points_delta) filter (where pl.created_at::date > v_ends - 3), 0) as last3
    from public.point_ledger pl
    where pl.organization_id = p_organization_id
      and pl.event_type = 'task_approved'
      and pl.created_at::date between v_starts and v_ends
    group by pl.employee_id
  ) p
  where p.total > 0
    and p.last3 > 3 * (p.total::numeric / v_days)
    and not exists (
      select 1 from public.anti_gaming_flags f
      where f.organization_id = p_organization_id and f.rule = 'period_end_spike'
        and f.subject_employee_id = p.employee_id and f.bonus_period_id = p_bonus_period_id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- run_anti_gaming_scan(org, period?): the explicit orchestrator (OQ-3). Authorized to
-- HR (has_role('hr')) or a trusted server/job context. Runs the task-scoped rules
-- always; the period-scoped rules only when a period is supplied. Returns the number of
-- new flags. SECURITY DEFINER; the detect_* helpers are NOT granted to authenticated
-- (only reachable through this orchestrator's authz gate).
-- -----------------------------------------------------------------------------
create or replace function public.run_anti_gaming_scan(
  p_organization_id uuid, p_bonus_period_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer := 0;
begin
  -- Authorized to HR (has_role) or a trusted server/job context. NOTE: current_user is
  -- unreliable in a SECURITY DEFINER function (it is the owner, not the caller), so a
  -- trusted context is detected by the ABSENCE of an authenticated JWT identity
  -- (auth.uid() IS NULL). An authenticated user always carries a JWT sub.
  if not (public.has_role('hr') or auth.uid() is null) then
    raise exception 'not authorized to run the anti-gaming scan (HR only)' using errcode = '42501';
  end if;

  v_n := v_n + public.detect_duplicate_task(p_organization_id);
  v_n := v_n + public.detect_tiny_task_splitting(p_organization_id);
  if p_bonus_period_id is not null then
    v_n := v_n + public.detect_same_reviewer_concentration(p_organization_id, p_bonus_period_id);
    v_n := v_n + public.detect_period_end_spike(p_organization_id, p_bonus_period_id);
  end if;
  return v_n;
end;
$$;

comment on function public.run_anti_gaming_scan(uuid, uuid) is
  'Anti-gaming detection orchestrator (Phase 7-A, OQ-3): runs 4 deterministic rules into anti_gaming_flags. '
  'HR/server only; idempotent (dual partial-unique index, OQ-2); D5 — flags only, no financial side effect.';

-- Grants: the orchestrator is callable by HR (authz inside) + server; the detect_*
-- helpers are server-only (not granted to authenticated → cannot bypass the authz gate).
revoke execute on function public.run_anti_gaming_scan(uuid, uuid) from public, anon;
grant execute on function public.run_anti_gaming_scan(uuid, uuid) to authenticated, service_role;

revoke execute on function public.detect_duplicate_task(uuid) from public, anon, authenticated;
revoke execute on function public.detect_tiny_task_splitting(uuid) from public, anon, authenticated;
revoke execute on function public.detect_same_reviewer_concentration(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.detect_period_end_spike(uuid, uuid) from public, anon, authenticated;
grant execute on function public.detect_duplicate_task(uuid) to service_role;
grant execute on function public.detect_tiny_task_splitting(uuid) to service_role;
grant execute on function public.detect_same_reviewer_concentration(uuid, uuid) to service_role;
grant execute on function public.detect_period_end_spike(uuid, uuid) to service_role;
