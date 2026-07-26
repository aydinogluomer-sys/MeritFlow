-- =============================================================================
-- Migration 0015 — disputes + dispute_events foundation  (Phase 3)
-- Refs: 07_DISPUTE_WORKFLOW_SPEC, 14_DATA_DICTIONARY (disputes/dispute_events),
--       15_RLS_POLICY_MATRIX (disputes/dispute_events §; owns_review_decision helper),
--       16 (§6 dispute machine, SI-6/SI-7), ADR-006 (append-only/audit), ADR-020,
--       Decision Lock D9. Phase 3 slice ONLY.
--
-- Scope: dispute lifecycle CONTAINER + guarantees (no post-decision engine).
--   * disputes: MUTABLE state machine (open→under_review→needs_info→under_review→
--     resolved→closed) with a validate trigger (allowed/forbidden transitions +
--     post-open identity immutability), D9 enforcement, a stored SLA due_at, and audit.
--   * dispute_events: APPEND-ONLY history, AUTO-WRITTEN by a SECURITY DEFINER trigger
--     on every disputes INSERT/status-transition (actor_id = auth.uid()); authenticated
--     cannot INSERT/UPDATE/DELETE it directly.
--
-- D9 (decision-owner cannot be final on their own decision):
--   * `decision_owner_id` is a STORED column (the owner of the disputed decision). The
--     app/producer populates it from target_type/target_id; deriving it automatically
--     (tracing to task_reviews etc.) is DEFERRED (those tables are gated). The DB
--     ENFORCES D9 against the stored value:
--       - CHECK assigned_reviewer_id <> decision_owner_id (a reviewer cannot be the owner)
--       - CHECK assigned_reviewer_id <> complainant_id
--       - resolve RLS WITH CHECK `NOT owns_review_decision(id)` (belt-and-suspenders)
--
-- SLA: `due_at` is STORED (+ sanity CHECK due_at > opened_at). The 5-business-day
--   computation (holiday calendar — OQ-DP-1) is DEFERRED; not computed here.
--
-- target_id is POLYMORPHIC (target_type varies; target tables are gated) → NO FK; the
--   app validates target existence. Same-org safety is on the FK'd actor columns only.
--
-- DELIBERATELY ABSENT (gated / later): post-decision effects (point_ledger
-- dispute_adjustment; new bonus_calculation_run + snapshot; bonus_ledger reversal/
-- accrual), notifications, reopen orchestration, free-form note events, task/review/
-- scoring/bonus engines, app/UI/API. No edits to 0001..0014 / existing tests. Local
-- dev/staging only — never production (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- owns_review_decision(dispute_id): TRUE when the current user is the owner of the
-- disputed decision (D9 guard). SECURITY DEFINER so it reads disputes regardless of RLS.
-- -----------------------------------------------------------------------------
-- NOTE: plpgsql (not sql) so the body's reference to public.disputes is resolved at
-- first call, not at CREATE time — this function is defined before the disputes table
-- (matching the codebase's trigger-before-table ordering).
create or replace function public.owns_review_decision(p_dispute_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  return exists (
    select 1 from public.disputes d
    where d.id = p_dispute_id and d.decision_owner_id = auth.uid()
  );
end;
$$;

comment on function public.owns_review_decision(uuid) is
  'D9 guard: is the current user the owner of the disputed decision (disputes.decision_owner_id).';

-- -----------------------------------------------------------------------------
-- validate_dispute_transition(): enforce the doc-16 §6 state machine + post-open
-- identity immutability. On INSERT status must be 'open'. On UPDATE, only the allowed
-- transitions are permitted; open→under_review requires an assigned reviewer; a
-- resolved/closed dispute is otherwise immutable. SECURITY DEFINER (org-scoped by row).
-- -----------------------------------------------------------------------------
create or replace function public.validate_dispute_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'dispute must start in status open (got %)', new.status using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE: identity fields are immutable once the dispute exists (set at open).
  if new.organization_id is distinct from old.organization_id
  or new.complainant_id  is distinct from old.complainant_id
  or new.dispute_type    is distinct from old.dispute_type
  or new.target_type     is distinct from old.target_type
  or new.target_id       is distinct from old.target_id
  or new.opened_at       is distinct from old.opened_at then
    raise exception 'dispute identity (org/complainant/type/target/opened_at) is immutable' using errcode = '23001';
  end if;

  -- Non-status updates (assign reviewer, set due_at/decision_owner) allowed only while
  -- the dispute is still active (not resolved/closed).
  if new.status = old.status then
    if old.status in ('resolved', 'closed') then
      raise exception 'resolved/closed dispute is immutable' using errcode = '23001';
    end if;
    return new;
  end if;

  if not (
       (old.status = 'open'         and new.status = 'under_review')
    or (old.status = 'under_review' and new.status in ('needs_info', 'resolved'))
    or (old.status = 'needs_info'   and new.status = 'under_review')
    or (old.status = 'resolved'     and new.status = 'closed')
  ) then
    raise exception 'invalid dispute transition: % -> %', old.status, new.status using errcode = '23514';
  end if;

  -- A dispute cannot enter review without an assigned reviewer (HR assigns — D9).
  if old.status = 'open' and new.status = 'under_review' and new.assigned_reviewer_id is null then
    raise exception 'dispute cannot move to under_review without an assigned reviewer (D9/assign)' using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_dispute_transition() is
  'Enforces the dispute state machine (doc 16 §6) + post-open identity immutability.';

-- -----------------------------------------------------------------------------
-- log_dispute_event(): AUTO-WRITE the append-only dispute_events history on every
-- disputes INSERT and status transition. SECURITY DEFINER so it can INSERT into
-- dispute_events (which has no authenticated write path). actor_id = auth.uid().
-- -----------------------------------------------------------------------------
create or replace function public.log_dispute_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'opened';
  elsif new.status is distinct from old.status then
    v_event := case
      when new.status = 'under_review' and old.status = 'open'       then 'assigned'
      when new.status = 'under_review' and old.status = 'needs_info' then 'info_provided'
      when new.status = 'needs_info'                                 then 'info_requested'
      when new.status = 'resolved'                                   then 'resolved'
      when new.status = 'closed'                                     then 'closed'
      else 'note'
    end;
  else
    return null;  -- non-status update: no event
  end if;

  insert into public.dispute_events
    (organization_id, dispute_id, event_type, actor_id, from_status, to_status)
  values
    (new.organization_id, new.id, v_event, auth.uid(),
     case when tg_op = 'INSERT' then null else old.status end, new.status);

  return null;
end;
$$;

comment on function public.log_dispute_event() is
  'Auto-writes the append-only dispute_events trail on every disputes INSERT / status transition (actor = auth.uid()).';

-- =============================================================================
-- disputes (mutable state machine). Confidential + personal-data.
-- =============================================================================
create table public.disputes (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  complainant_id      uuid not null,
  dispute_type        text not null,
  target_type         text not null,
  target_id           uuid not null,                        -- polymorphic; NO FK (app-validated)
  status              text not null default 'open',
  decision_owner_id   uuid,                                 -- owner of the disputed decision (D9); app-populated
  assigned_reviewer_id uuid,
  resolution          text,
  decision_note       text,
  opened_at           timestamptz not null default now(),
  due_at              timestamptz,                          -- SLA (stored; business-day calc deferred)
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint disputes_type_chk check (dispute_type in
    ('task_points_too_low', 'unfair_rejection', 'quality_score_dispute', 'missing_task_credit',
     'bonus_calculation_dispute', 'manager_bias_report', 'anomaly_false_positive', 'system_error',
     'clawback_dispute')),
  constraint disputes_target_type_chk check (target_type in
    ('task', 'point_ledger', 'bonus_allocation', 'bonus_calculation_run', 'clawback', 'other')),
  constraint disputes_status_chk check (status in ('open', 'under_review', 'needs_info', 'resolved', 'closed')),
  constraint disputes_resolution_chk check (resolution is null or resolution in ('accepted', 'rejected')),
  constraint disputes_due_at_chk check (due_at is null or due_at > opened_at),
  -- D9: an assigned reviewer cannot be the decision owner, nor the complainant.
  constraint disputes_reviewer_not_owner_chk
    check (assigned_reviewer_id is null or decision_owner_id is null or assigned_reviewer_id <> decision_owner_id),
  constraint disputes_reviewer_not_complainant_chk
    check (assigned_reviewer_id is null or assigned_reviewer_id <> complainant_id),
  -- Resolution fields exist iff the dispute is resolved/closed.
  constraint disputes_resolved_consistency_chk check (
    case
      when status in ('resolved', 'closed')
        then resolution is not null and decision_note is not null and resolved_at is not null
      else resolution is null and decision_note is null and resolved_at is null
    end),
  -- composite unique so dispute_events can reference (id, organization_id) same-org.
  constraint disputes_id_org_uq unique (id, organization_id),
  -- Same-org actors (SI-7).
  constraint disputes_complainant_org_fk
    foreign key (organization_id, complainant_id)
    references public.memberships (organization_id, profile_id),
  constraint disputes_reviewer_org_fk
    foreign key (organization_id, assigned_reviewer_id)
    references public.memberships (organization_id, profile_id),
  constraint disputes_owner_org_fk
    foreign key (organization_id, decision_owner_id)
    references public.memberships (organization_id, profile_id)
);

comment on table public.disputes is
  'Dispute lifecycle (doc 16 §6): open→under_review→needs_info→under_review→resolved→closed. Mutable state '
  'machine; identity immutable post-open. D9: reviewer ≠ decision_owner ≠ complainant; resolver ≠ owner. SLA '
  'due_at stored (business-day calc deferred). target_id polymorphic (no FK). DELETE forbidden; audited. '
  'RLS: complainant + assigned reviewer + HR + Auditor (Finance/Support excluded). Sensitivity: confidential, '
  'personal-data.';

create index idx_disputes_org_status_reviewer on public.disputes (organization_id, status, assigned_reviewer_id);
create index idx_disputes_complainant on public.disputes (complainant_id);
create index idx_disputes_due_at on public.disputes (due_at);

create trigger trg_disputes_set_updated_at
  before update on public.disputes
  for each row execute function public.set_updated_at();

create trigger trg_disputes_validate
  before insert or update on public.disputes
  for each row execute function public.validate_dispute_transition();

create trigger trg_disputes_prevent_delete
  before delete on public.disputes
  for each row execute function public.prevent_delete();

-- Auto-write the append-only event trail (fires after the row is written).
create trigger trg_disputes_log_event
  after insert or update on public.disputes
  for each row execute function public.log_dispute_event();

create trigger trg_audit_disputes
  after insert or update on public.disputes
  for each row execute function public.log_audit();

-- =============================================================================
-- dispute_events (append-only history; AUTO-written by the trigger above). Audit-critical.
-- =============================================================================
create table public.dispute_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dispute_id      uuid not null,
  event_type      text not null,
  actor_id        uuid not null,
  from_status     text,
  to_status       text,
  note            text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint dispute_events_type_chk check (event_type in
    ('opened', 'assigned', 'reassigned', 'info_requested', 'info_provided', 'resolved', 'closed', 'note')),
  constraint dispute_events_from_status_chk
    check (from_status is null or from_status in ('open', 'under_review', 'needs_info', 'resolved', 'closed')),
  constraint dispute_events_to_status_chk
    check (to_status is null or to_status in ('open', 'under_review', 'needs_info', 'resolved', 'closed')),
  constraint dispute_events_dispute_org_fk
    foreign key (dispute_id, organization_id)
    references public.disputes (id, organization_id) on delete cascade,
  constraint dispute_events_actor_org_fk
    foreign key (organization_id, actor_id)
    references public.memberships (organization_id, profile_id)
);

comment on table public.dispute_events is
  'Append-only dispute history (doc 16 §6). AUTO-written by log_dispute_event() on each disputes '
  'INSERT/transition; authenticated has NO direct write path. UPDATE/DELETE forbidden (immutable trail). '
  'RLS follows parent-dispute visibility (+ Auditor). Sensitivity: audit-critical.';

create index idx_dispute_events_dispute_created on public.dispute_events (dispute_id, created_at);

-- Append-only: block UPDATE and DELETE entirely (immutable trail).
create trigger trg_dispute_events_append_only
  before update or delete on public.dispute_events
  for each row execute function public.prevent_mutation();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies
-- =============================================================================

-- disputes: read complainant + assigned reviewer + HR + Auditor (Finance/Support excluded).
-- open by dispute.open (own); assign/manage by HR (has_role('hr')); resolve by the assigned
-- reviewer (dispute.resolve, ≠ decision owner). No DELETE.
alter table public.disputes enable row level security;
alter table public.disputes force row level security;
revoke all on public.disputes from anon, authenticated;
grant select, insert, update on public.disputes to authenticated;                 -- NO delete
grant all on public.disputes to service_role;

create policy disputes_select on public.disputes
  for select to authenticated
  using (
    organization_id = public.current_org()
    and (complainant_id = auth.uid()
         or assigned_reviewer_id = auth.uid()
         or public.has_role('hr')
         or public.has_role('auditor'))
  );

create policy disputes_insert on public.disputes
  for insert to authenticated
  with check (
    organization_id = public.current_org()
    and public.has_permission('dispute.open')
    and complainant_id = auth.uid()
    and status = 'open'
  );

create policy disputes_update on public.disputes
  for update to authenticated
  using (
    organization_id = public.current_org()
    and (public.has_role('hr')
         or (public.has_permission('dispute.resolve') and assigned_reviewer_id = auth.uid()))
  )
  with check (
    organization_id = public.current_org()
    and (
      -- HR: assigns the reviewer and manages every transition EXCEPT the resolve act.
      -- (HR-only via has_role('hr') — the assign action is not a separate permission in
      --  this slice to avoid changing the seeded permission catalog; D9.)
      (public.has_role('hr') and status <> 'resolved')
      -- Assigned reviewer (dispute.resolve): resolve/route, but never on their own decision (D9).
      or (public.has_permission('dispute.resolve')
          and assigned_reviewer_id = auth.uid()
          and not public.owns_review_decision(id))
    )
  );
-- No DELETE policy (and no privilege); prevent_delete trigger is defense-in-depth.

-- dispute_events: read follows parent-dispute visibility (the disputes RLS filters the
-- subquery) + Auditor; writes are AUTO-ONLY (definer trigger) — no authenticated write.
alter table public.dispute_events enable row level security;
alter table public.dispute_events force row level security;
revoke all on public.dispute_events from anon, authenticated;
grant select on public.dispute_events to authenticated;                           -- SELECT only
grant all on public.dispute_events to service_role;

create policy dispute_events_select on public.dispute_events
  for select to authenticated
  using (
    organization_id = public.current_org()
    and exists (select 1 from public.disputes d where d.id = dispute_events.dispute_id)
  );
-- No INSERT/UPDATE/DELETE policy and no privilege (auto-written by definer trigger only).
