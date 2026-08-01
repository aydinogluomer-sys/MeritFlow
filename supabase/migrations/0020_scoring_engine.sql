-- =============================================================================
-- Migration 0020 — scoring engine (approve → point_ledger task_approved)  (Phase 5)
-- Refs: 04_SCORING_ENGINE_SPEC (formula/multipliers §47-65), 14 (point_ledger),
--       15 (point_ledger RLS), 16 (§1 task machine, SI-1/SI-2/SI-11/SI-12/INV-1),
--       Decision Lock D3/AD4/AD5/AD7, ADR-005/012/020. Phase 5 core slice.
--
-- Scope: when a task becomes `approved` (review-driven, Phase 4), compute final_points
-- deterministically from the LOCKED, PUBLISHED policy version, write exactly ONE
-- point_ledger `task_approved` earning row (breakdown in metadata), and cache
-- tasks.final_points. Server-side only; no client scoring authority (SI-11).
--
-- Locked decisions:
--   A scoring runs in a BEFORE UPDATE trigger on tasks (status→approved), named to run
--     AFTER trg_tasks_validate. It sets NEW.final_points inline (no recursion) and
--     inserts the ledger row.
--   C tasks.final_points ALTERed integer → numeric (scoring is non-integer, e.g. 187.5).
--   D raw numeric, no DB rounding (doc 04 §21/§116). points_delta is the source of truth.
--   E the approving task_reviews.timeliness/quality drive the multipliers (AD4: based on
--     submitted_at; a late approval never re-derives/penalizes).
--   F revision penalty rate/cap read from scoring_policy_versions.revision_penalty_rule.
--   H point_ledger.task_id is nullable; a CHECK requires it (and a policy version, and no
--     reverses ref) for event_type='task_approved'.
--   I no second audit for the ledger row — the approve is already audited by Phase 4
--     (tasks status→approved → log_audit). The point_ledger audit WHEN-clause (0009)
--     excludes task_approved.
--   SI-1 idempotency: a partial unique index guarantees one task_approved row per task.
--   AD5 collaboration_score is recorded in breakdown metadata only; it never affects
--     final_points (absent from the formula). AD7 a draft/unpublished version cannot score.
--   No new permission/role (approve authz is Phase 4 task.review). Finance stays excluded
--     from raw point_ledger (0009 RLS unchanged). No bonus changes.
--
-- DELIBERATELY ABSENT (gated / later): manual override/adjustment (5-b, point.override
-- 2-step → manual_adjustment), timeliness derivation from submitted_at/due_date+thresholds
-- (reviewer/app provides timeliness), bonus/pool/allocation, notifications, app/UI. No
-- edits to 0001..0019 / existing tests (except the single authorized 0013 assertion).
-- Local dev/staging only (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- compute_final_points(): pure, deterministic scoring formula (doc 04 §57-65).
--   final = base * m_complexity * m_impact * m_quality * m_timeliness * (1 - penalty)
--   penalty = min(revision_count * rate_per_revision, cap)   [from revision_penalty_rule]
-- collaboration_score is NOT a parameter (AD5).
-- -----------------------------------------------------------------------------
create or replace function public.compute_final_points(
  p_base           numeric,
  p_multipliers    jsonb,
  p_penalty_rule   jsonb,
  p_complexity     text,
  p_impact         text,
  p_quality        text,
  p_timeliness     text,
  p_revision_count integer
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select p_base
    * (p_multipliers -> 'complexity' ->> p_complexity)::numeric
    * (p_multipliers -> 'impact'     ->> p_impact)::numeric
    * (p_multipliers -> 'quality'    ->> p_quality)::numeric
    * (p_multipliers -> 'timeliness' ->> p_timeliness)::numeric
    * (1 - least(
            p_revision_count * coalesce((p_penalty_rule ->> 'rate_per_revision')::numeric, 0.05),
            coalesce((p_penalty_rule ->> 'cap')::numeric, 0.25)
          ));
$$;

comment on function public.compute_final_points(numeric, jsonb, jsonb, text, text, text, text, integer) is
  'Deterministic task scoring (doc 04 §57-65). collaboration_score excluded (AD5). Multipliers/penalty '
  'from the locked policy version. Raw numeric (no rounding — D).';

-- -----------------------------------------------------------------------------
-- score_task_on_approve(): BEFORE UPDATE on tasks. On the status→approved transition,
-- reads the LOCKED published policy version + the approving review, computes final_points
-- (server-side — SI-11), sets NEW.final_points, and inserts the single task_approved
-- earning ledger row (breakdown metadata). SECURITY DEFINER (writes point_ledger which is
-- server-only, and reads the policy version regardless of caller RLS).
-- -----------------------------------------------------------------------------
create or replace function public.score_task_on_approve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_multipliers  jsonb;
  v_penalty_rule jsonb;
  v_pv_status    text;
  v_quality      text;
  v_timeliness   text;
  v_collab       text;
  v_final        numeric;
begin
  if not (new.status = 'approved' and old.status is distinct from 'approved') then
    return new;
  end if;

  -- AD7: the task's policy version must be PUBLISHED (locked snapshot); draft cannot score.
  select spv.multipliers, spv.revision_penalty_rule, spv.status
    into v_multipliers, v_penalty_rule, v_pv_status
  from public.scoring_policy_versions spv
  where spv.id = new.scoring_policy_version_id and spv.organization_id = new.organization_id;

  if v_pv_status is distinct from 'published' then
    raise exception 'cannot score with a non-published scoring_policy_version (status %) — AD7',
      coalesce(v_pv_status, '<none>') using errcode = '23514';
  end if;

  -- The approving review supplies quality + timeliness (E); collaboration is metadata-only (AD5).
  select tr.quality, tr.timeliness, tr.collaboration_score
    into v_quality, v_timeliness, v_collab
  from public.task_reviews tr
  where tr.task_id = new.id and tr.decision = 'approve'
  order by tr.created_at desc
  limit 1;

  -- Scoring is review-driven: it needs the approving review's quality/timeliness. A
  -- trusted DIRECT approve (admin/migration/test setup, no review) has nothing to score
  -- with, so scoring is SKIPPED (no ledger row, final_points left null) rather than
  -- erroring. Normal client approves are review-driven (Phase 4) and always have a review.
  if v_quality is null then
    return new;
  end if;

  v_final := public.compute_final_points(
    new.base_points::numeric, v_multipliers, v_penalty_rule,
    new.complexity, new.impact, v_quality, v_timeliness, new.revision_count
  );

  -- Cache on the task (numeric derivative; source of truth is the ledger row below).
  new.final_points := v_final;

  -- Exactly one task_approved earning row (SI-1; the partial unique index is the belt).
  insert into public.point_ledger (
    organization_id, employee_id, event_type, points_delta, reason,
    scoring_policy_version_id, task_id, created_by, metadata
  ) values (
    new.organization_id,
    new.assigned_to,                                   -- points accrue to the assignee
    'task_approved',
    v_final,
    'task_approved: ' || new.id::text,
    new.scoring_policy_version_id,
    new.id,
    coalesce(auth.uid(), new.created_by),              -- the approving reviewer (fallback: creator)
    jsonb_build_object(
      'base_points',            new.base_points,
      'complexity',             new.complexity,
      'complexity_multiplier',  (v_multipliers -> 'complexity' ->> new.complexity)::numeric,
      'impact',                 new.impact,
      'impact_multiplier',      (v_multipliers -> 'impact' ->> new.impact)::numeric,
      'quality',                v_quality,
      'quality_multiplier',     (v_multipliers -> 'quality' ->> v_quality)::numeric,
      'timeliness',             v_timeliness,
      'timeliness_multiplier',  (v_multipliers -> 'timeliness' ->> v_timeliness)::numeric,
      'revision_count',         new.revision_count,
      'revision_penalty_rate',  least(
                                  new.revision_count * coalesce((v_penalty_rule ->> 'rate_per_revision')::numeric, 0.05),
                                  coalesce((v_penalty_rule ->> 'cap')::numeric, 0.25)),
      'last_valid_submitted_at', new.last_valid_submitted_at,
      'collaboration_score',    v_collab,              -- recorded only; NOT scoring (AD5)
      'final_points',           v_final
    )
  );

  return new;
end;
$$;

comment on function public.score_task_on_approve() is
  'BEFORE UPDATE tasks scoring (Phase 5): on →approved, compute final_points from the locked published '
  'policy version + approving review, set NEW.final_points, write one point_ledger task_approved row (SI-1). '
  'Server-side (SI-11); AD5 collaboration non-scoring; AD7 published-only.';

-- =============================================================================
-- ALTER point_ledger — add task_id + task_approved event (H) + SI-1 idempotency.
-- The event_type CHECK is dropped and re-added UNDER THE SAME NAME so the existing
-- 0003 assertion (invalid event_type rejected by point_ledger_event_type_chk) holds.
-- =============================================================================
alter table public.point_ledger add column task_id uuid;

alter table public.point_ledger
  add constraint point_ledger_task_org_fk
  foreign key (task_id, organization_id)
  references public.tasks (id, organization_id);

alter table public.point_ledger drop constraint point_ledger_event_type_chk;
alter table public.point_ledger
  add constraint point_ledger_event_type_chk
  check (event_type in ('manual_adjustment', 'reversal', 'task_approved'));

-- task_approved must carry a task + policy version and must not be a reversal (H).
alter table public.point_ledger
  add constraint point_ledger_task_approved_chk
  check (
    event_type <> 'task_approved'
    or (task_id is not null and scoring_policy_version_id is not null and reverses_entry_id is null)
  );

-- SI-1: exactly one task_approved earning row per task (idempotency belt).
create unique index point_ledger_task_approved_uq
  on public.point_ledger (task_id)
  where event_type = 'task_approved';

-- =============================================================================
-- ALTER tasks — final_points integer → numeric (C). Column is null everywhere (Phase 4
-- never wrote it), so the type change is a safe no-data cast.
-- =============================================================================
alter table public.tasks alter column final_points type numeric;

-- =============================================================================
-- Scoring trigger — runs AFTER trg_tasks_validate (alphabetical: 'validate' < 'zz').
-- =============================================================================
create trigger trg_tasks_zz_score_on_approve
  before update on public.tasks
  for each row execute function public.score_task_on_approve();
