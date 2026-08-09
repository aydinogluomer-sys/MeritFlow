-- =============================================================================
-- Migration 0025 — dispute point adjustment (accepted dispute → point_ledger)  (Phase 7-B)
-- Refs: 07_DISPUTE_WORKFLOW_SPEC §62 (accepted-points → point_ledger dispute_adjustment
--       + audit), 19_PHASE_7_ANTI_GAMING_DISPUTE_PLAN §5.2, Decision Lock D9/D2, ADR-005
--       (append-only ledger), CLAUDE.md (dispute decision → audit). Builds on 0009
--       (point_ledger) + 0015 (disputes) + 0020 (the DROP+ADD event_type precedent).
--
-- Scope (Phase 7-B ONLY): the resolved+accepted dispute → ONE point_ledger
-- `dispute_adjustment` delta row. apply_dispute_point_adjustment() (SECURITY DEFINER,
-- server-only) validates the dispute is resolved+accepted, then appends a single delta
-- for the complainant, idempotent per dispute, audited. Widens the point_ledger
-- event_type vocabulary (DROP+ADD under the same name — 0020 precedent) and the audit
-- WHEN clause (task_approved stays un-audited, as in 0020).
--
-- Locked OQ decisions (Phase 7-B scope-lock):
--   OQ-7B-1  authz = has_permission('dispute.resolve') OR auth.uid() IS NULL.
--   OQ-7B-2  employee_id = disputes.complainant_id (derived; no explicit param).
--   OQ-7B-3  not resolved+accepted => raise 23514 (fail-closed; no silent no-op).
--   OQ-7B-4  no dispute_type restriction in 7-B.
--   OQ-7B-5  p_points_delta must be non-zero (0 => 23514).
--
-- DELIBERATELY ABSENT (still gated): bonus_ledger reversal / recalculation (7-C),
-- dispute_type routing, new permission (catalog stays 20), seed, app/UI/API. No edits
-- to 0001..0024 or existing tests. Local dev/staging only — never production (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- point_ledger: additive dispute_id + same-org composite FK to disputes (SI-7),
-- widen the event_type vocabulary, dispute_adjustment integrity CHECK, and the
-- per-dispute idempotency index. (Additive ALTER on an earlier table, permitted —
-- mirrors 0020 adding task_id + point_ledger_task_approved_uq.)
-- -----------------------------------------------------------------------------
alter table public.point_ledger add column dispute_id uuid;

alter table public.point_ledger
  add constraint point_ledger_dispute_org_fk
  foreign key (dispute_id, organization_id)
  references public.disputes (id, organization_id);

-- Widen the event vocabulary. DROP+ADD UNDER THE SAME NAME so the 0003 assertion
-- (invalid event_type rejected by point_ledger_event_type_chk) still holds.
alter table public.point_ledger drop constraint point_ledger_event_type_chk;
alter table public.point_ledger
  add constraint point_ledger_event_type_chk
  check (event_type in ('manual_adjustment', 'reversal', 'task_approved', 'dispute_adjustment'));

-- A dispute_adjustment must carry a dispute_id and is a delta (never a reversal row).
alter table public.point_ledger
  add constraint point_ledger_dispute_adjustment_chk
  check (
    event_type <> 'dispute_adjustment'
    or (dispute_id is not null and reverses_entry_id is null)
  );

-- Idempotency: exactly one dispute_adjustment row per dispute (backstop for the
-- function's where-not-exists guard).
create unique index point_ledger_dispute_adjustment_uq
  on public.point_ledger (dispute_id)
  where event_type = 'dispute_adjustment';

-- -----------------------------------------------------------------------------
-- Audit: widen the point_ledger INSERT audit WHEN clause to include
-- dispute_adjustment (spec §62 + CLAUDE.md: a dispute decision is auditable).
-- task_approved stays OUT (0020 behaviour — automatic scoring rows are not audited;
-- the task approval itself is audited via tasks/task_events). Triggers cannot ALTER a
-- WHEN clause, so DROP+CREATE.
-- -----------------------------------------------------------------------------
drop trigger trg_audit_point_ledger on public.point_ledger;
create trigger trg_audit_point_ledger
  after insert on public.point_ledger
  for each row
  when (new.event_type in ('manual_adjustment', 'reversal', 'dispute_adjustment'))
  execute function public.log_audit();

-- -----------------------------------------------------------------------------
-- apply_dispute_point_adjustment(dispute, delta, reason, actor): the post-decision
-- point effect. Requires the dispute resolved+accepted (ADR-006 boundary spirit),
-- appends ONE dispute_adjustment delta for the complainant, idempotent per dispute.
-- SECURITY DEFINER, server-only. Ordered checks: authz -> non-zero delta -> load
-- dispute -> precondition -> idempotency -> insert -> return id.
-- -----------------------------------------------------------------------------
create function public.apply_dispute_point_adjustment(
  p_dispute_id   uuid,
  p_points_delta numeric,
  p_reason       text,
  p_actor        uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org         uuid;
  v_complainant uuid;
  v_status      text;
  v_resolution  text;
  v_existing    uuid;
  v_row         uuid;
begin
  -- (authz — OQ-7B-1) dispute resolver (dispute.resolve) or a trusted server/job
  -- context. auth.uid() IS NULL = no authenticated JWT identity (current_user is
  -- unreliable inside a SECURITY DEFINER — it is the owner, not the caller).
  if not (public.has_permission('dispute.resolve') or auth.uid() is null) then
    raise exception 'not authorized to apply a dispute point adjustment (dispute.resolve required)' using errcode = '42501';
  end if;

  -- (OQ-7B-5) a zero delta is meaningless.
  if p_points_delta = 0 then
    raise exception 'dispute point adjustment delta must be non-zero' using errcode = '23514';
  end if;

  -- Load the dispute; org/employee are DERIVED from the row (no cross-org param — SI-7).
  select organization_id, complainant_id, status, resolution
    into v_org, v_complainant, v_status, v_resolution
  from public.disputes where id = p_dispute_id;
  if not found then
    raise exception 'dispute % not found', p_dispute_id using errcode = '23503';
  end if;

  -- (OQ-7B-3, fail-closed) must be resolved/closed AND accepted; else no row.
  if not (v_status in ('resolved', 'closed') and v_resolution = 'accepted') then
    raise exception 'dispute % is not resolved+accepted (status %, resolution %) — no adjustment applied',
      p_dispute_id, v_status, coalesce(v_resolution, 'null') using errcode = '23514';
  end if;

  -- Idempotency: an adjustment already exists for this dispute => no-op (return it).
  select id into v_existing
  from public.point_ledger
  where dispute_id = p_dispute_id and event_type = 'dispute_adjustment'
  limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Append the single delta for the complainant (OQ-7B-2). reason non-empty is
  -- enforced by point_ledger_reason_nonempty_chk. Audited by the widened WHEN clause.
  insert into public.point_ledger
    (organization_id, employee_id, event_type, points_delta, reason, dispute_id, created_by, metadata)
  values
    (v_org, v_complainant, 'dispute_adjustment', p_points_delta, p_reason, p_dispute_id, p_actor,
     jsonb_build_object('dispute_id', p_dispute_id))
  returning id into v_row;

  return v_row;
end;
$$;

comment on function public.apply_dispute_point_adjustment(uuid, numeric, text, uuid) is
  'Phase 7-B: resolved+accepted dispute → one append-only point_ledger dispute_adjustment '
  'delta for the complainant; idempotent per dispute; audited. SECURITY DEFINER, server-only. '
  'authz has_permission(''dispute.resolve'') OR auth.uid() IS NULL; fail-closed on non-accepted.';

revoke execute on function public.apply_dispute_point_adjustment(uuid, numeric, text, uuid) from public, anon;
grant execute on function public.apply_dispute_point_adjustment(uuid, numeric, text, uuid) to authenticated, service_role;
