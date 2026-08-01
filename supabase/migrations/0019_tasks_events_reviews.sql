-- =============================================================================
-- Migration 0019 — tasks + task_events + task_reviews foundation  (Phase 4)
-- Refs: 04_SCORING_ENGINE_SPEC (complexity/impact/quality/timeliness enums),
--       14_DATA_DICTIONARY (tasks/task_events/task_reviews §154-220),
--       15_RLS_POLICY_MATRIX (tasks/task_events/task_reviews §58-82),
--       16 (§1 task machine, §2 review machine), Decision Lock D3/AD4/AD5,
--       ADR-020. Phase 4 core slice.
--
-- Scope: the submit→review LIFECYCLE CONTAINER + self-approval guarantee + append-only
-- history. NOT the scoring engine.
--
-- Locked decisions (this slice):
--   A review-driven transition: `task_reviews` INSERT is the authoritative review; a
--     SECURITY DEFINER trigger applies the tasks status change. Reviewers never UPDATE
--     tasks directly for approve/reject/needs_revision — a direct client UPDATE into
--     those states is rejected (only a trusted server/definer context may set them).
--   B one core slice: tasks + task_events + task_reviews together.
--   C project_id/objective_id are nullable UUID context fields with NO FK (deferred).
--   D period-locked mutation guard DEFERRED (no task↔period link yet).
--   E task_assignments/task_comments/task_attachments DEFERRED (no storage work).
--   F approved→point_ledger DEFERRED to Phase 5: this slice writes NO point_ledger row
--     on approve (proven by a pgTAP count-unchanged assertion). No final_points math.
--   G quality enum includes 'poor'; approve with quality='poor' is rejected (D3).
--   Self-approval hard block (AD4): reviewer_id <> assignee, enforced at review INSERT
--     (SECURITY DEFINER, reads tasks) + a tasks column CHECK + a transition belt.
--   No new permission/role — task.create/assign/submit/review already seeded (catalog
--     stays 20).
--
-- DELIBERATELY ABSENT (gated / later): scoring engine + final_points + approve→ledger
-- (Phase 5), period-lock guard, task_assignments/comments/attachments + storage,
-- projects/objectives tables, notifications, app/Server Actions/UI. No edits to
-- 0001..0018 / existing tests. Local dev/staging only (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- validate_task_transition(): doc-16 §1 status machine + AD4 timing/counters.
-- INSERT must be draft|assigned. UPDATE follows the allowed transitions; transitions
-- INTO approved/rejected/needs_revision are review-driven — only a trusted server
-- context (the SECURITY DEFINER review trigger / bypassrls) may set them, never a
-- direct client UPDATE. Self-approval belt on approve. Server-stamps the timing fields.
-- -----------------------------------------------------------------------------
create or replace function public.validate_task_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor   uuid    := auth.uid();
  v_trusted boolean := current_user not in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'assigned') then
      raise exception 'task must be created in draft or assigned (got %)', new.status using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE: non-status field edits are allowed (notes, reviewer assignment, etc.).
  if new.status = old.status then
    return new;
  end if;

  if not (
       (old.status = 'draft'          and new.status = 'assigned')
    or (old.status = 'assigned'       and new.status = 'in_progress')
    or (old.status = 'in_progress'    and new.status = 'submitted')
    or (old.status = 'submitted'      and new.status in ('needs_revision', 'approved', 'rejected'))
    or (old.status = 'needs_revision' and new.status = 'in_progress')
    or (old.status in ('assigned', 'in_progress') and new.status = 'cancelled')
    or (old.status in ('approved', 'rejected', 'cancelled') and new.status = 'archived')
  ) then
    raise exception 'invalid task transition: % -> %', old.status, new.status using errcode = '23514';
  end if;

  -- Review-driven states must come from a trusted context (Decision A).
  if new.status in ('approved', 'rejected', 'needs_revision') and not v_trusted then
    raise exception 'task % is review-driven (insert a task_review, not a direct update)', new.status using errcode = '23514';
  end if;

  -- Self-approval belt (AD4): the acting reviewer cannot be the assignee.
  if new.status = 'approved' and v_actor is not distinct from old.assigned_to then
    raise exception 'self-approval is not permitted' using errcode = '23514';
  end if;

  -- AD4 timing + counters (server-stamped; ignore client-supplied values).
  if new.status = 'submitted' then
    new.submitted_at            := now();
    new.last_valid_submitted_at := now();
  elsif new.status = 'needs_revision' then
    new.revision_count          := old.revision_count + 1;
    new.submitted_at            := old.submitted_at;
    new.last_valid_submitted_at := old.last_valid_submitted_at;
  elsif new.status = 'approved' then
    new.approved_at  := now();
    new.completed_at := now();
  elsif new.status = 'rejected' then
    new.rejected_at  := now();
    new.completed_at := now();
  end if;

  return new;
end;
$$;

comment on function public.validate_task_transition() is
  'Task status machine (doc 16 §1) + AD4 timing. Review-driven states (approved/rejected/needs_revision) '
  'only from a trusted context; self-approval belt on approve.';

-- -----------------------------------------------------------------------------
-- log_task_event(): append-only history writer (AD4). AFTER INSERT/UPDATE on tasks;
-- writes one task_events row per status change (actor_id = auth.uid()). SECURITY
-- DEFINER so it can write task_events regardless of the caller's RLS.
-- -----------------------------------------------------------------------------
create or replace function public.log_task_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from  text;
  v_event text;
begin
  if tg_op = 'UPDATE' then
    if new.status = old.status then
      return new;   -- no status change → no event
    end if;
    v_from := old.status;
  end if;

  v_event := case new.status
    when 'submitted'      then 'submitted'
    when 'needs_revision' then 'revision_requested'
    when 'approved'       then 'approved'
    when 'rejected'       then 'rejected'
    when 'assigned'       then 'assigned'
    when 'cancelled'      then 'cancelled'
    when 'archived'       then 'archived'
    else 'status_change'
  end;

  insert into public.task_events (
    organization_id, task_id, event_type, actor_id, from_status, to_status, submitted_at_snapshot
  ) values (
    new.organization_id, new.id, v_event, auth.uid(), v_from, new.status, new.submitted_at
  );

  return new;
end;
$$;

comment on function public.log_task_event() is
  'Append-only task_events writer per status change (AD4 history). SECURITY DEFINER.';

-- -----------------------------------------------------------------------------
-- validate_task_review(): BEFORE INSERT on task_reviews. SECURITY DEFINER (reads
-- tasks). Enforces: task exists same-org, reviewer = actor, self-approval block
-- (reviewer <> assignee), reviewer manages the task team (doc 16 §2), task is
-- 'submitted'. D3 (approve ⇒ quality<>poor) is a table CHECK.
-- -----------------------------------------------------------------------------
create or replace function public.validate_task_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignee uuid;
  v_status   text;
  v_team     uuid;
  v_org      uuid;
begin
  select assigned_to, status, team_id, organization_id
    into v_assignee, v_status, v_team, v_org
  from public.tasks
  where id = new.task_id;

  if not found or v_org is distinct from new.organization_id then
    raise exception 'task % not found in org % (SI-7)', new.task_id, new.organization_id using errcode = '23503';
  end if;

  if new.reviewer_id is distinct from auth.uid() then
    raise exception 'reviewer_id must be the acting user' using errcode = '42501';
  end if;

  if new.reviewer_id is not distinct from v_assignee then
    raise exception 'self-review/approval is not permitted (reviewer = assignee)' using errcode = '23514';
  end if;

  if not public.manages_team(v_team) then
    raise exception 'reviewer must manage the task team' using errcode = '42501';
  end if;

  if v_status <> 'submitted' then
    raise exception 'task must be submitted to review (got %)', v_status using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_task_review() is
  'Review INSERT guard (doc 16 §2): same-org task, reviewer=actor, self-approval block, own-team, submitted.';

-- -----------------------------------------------------------------------------
-- apply_review_to_task(): AFTER INSERT on task_reviews. SECURITY DEFINER — applies
-- the reviewer decision as the authoritative tasks status transition (Decision A).
-- Runs in a trusted context so validate_task_transition permits the review state.
-- -----------------------------------------------------------------------------
create or replace function public.apply_review_to_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_status text := case new.decision
    when 'approve'        then 'approved'
    when 'needs_revision' then 'needs_revision'
    when 'reject'         then 'rejected'
  end;
begin
  update public.tasks
    set status = v_new_status
  where id = new.task_id and organization_id = new.organization_id;

  return new;
end;
$$;

comment on function public.apply_review_to_task() is
  'Applies a task_review decision as the authoritative tasks status transition (Decision A). SECURITY DEFINER.';

-- =============================================================================
-- tasks (performance input; point source). Mutable status machine; DELETE forbidden.
-- =============================================================================
create table public.tasks (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  team_id                   uuid not null,
  title                     text not null,
  status                    text not null default 'draft',
  created_by                uuid not null,
  assigned_to               uuid not null,
  reviewer_id               uuid,                                   -- designated reviewer (optional)
  complexity                text not null,
  impact                    text not null,
  base_points               integer not null,
  scoring_policy_version_id uuid not null,
  project_id                uuid,                                   -- context; no FK (Decision C)
  objective_id              uuid,                                   -- context; no FK (Decision C)
  description               text,
  task_type                 text,
  priority                  text,
  urgency                   text,
  estimated_effort          text,
  due_date                  date,
  acceptance_criteria       text,
  evidence_required         boolean not null default false,
  submitted_at              timestamptz,
  approved_at               timestamptz,
  rejected_at               timestamptz,
  completed_at              timestamptz,
  revision_count            integer not null default 0,
  last_valid_submitted_at   timestamptz,
  final_points              integer,                                -- Phase 5 writes this (derived cache)
  anomaly_status            text,
  reviewer_note             text,
  employee_note             text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint tasks_status_chk check (status in
    ('draft','assigned','in_progress','submitted','needs_revision','approved','rejected','cancelled','archived')),
  constraint tasks_complexity_chk check (complexity in ('low','medium','high','critical')),
  constraint tasks_impact_chk     check (impact in ('low','medium','high','strategic')),
  constraint tasks_base_points_nonneg_chk check (base_points >= 0),
  constraint tasks_revision_count_nonneg_chk check (revision_count >= 0),
  constraint tasks_reviewer_not_assignee_chk check (reviewer_id is null or reviewer_id <> assigned_to),
  -- final_points is only meaningful once approved (Phase 5 writes it; null here).
  constraint tasks_final_points_when_approved_chk check (final_points is null or status = 'approved'),
  -- Same-org composite FKs (SI-7).
  constraint tasks_team_org_fk
    foreign key (team_id, organization_id) references public.teams (id, organization_id),
  constraint tasks_assignee_org_fk
    foreign key (organization_id, assigned_to) references public.memberships (organization_id, profile_id),
  constraint tasks_creator_org_fk
    foreign key (organization_id, created_by) references public.memberships (organization_id, profile_id),
  constraint tasks_reviewer_org_fk
    foreign key (organization_id, reviewer_id) references public.memberships (organization_id, profile_id),
  constraint tasks_policy_org_fk
    foreign key (scoring_policy_version_id, organization_id)
    references public.scoring_policy_versions (id, organization_id),
  constraint tasks_id_org_uq unique (id, organization_id)
);

comment on table public.tasks is
  'Performance task (doc 16 §1). Status machine draft→assigned→in_progress→submitted→(needs_revision loop)→'
  'approved|rejected; cancelled/archived terminal. Review-driven approve/reject/needs_revision (Decision A). '
  'AD4 timing (submitted_at/last_valid_submitted_at/revision_count). final_points is a Phase-5 derived cache '
  '(null here; no ledger write on approve). DELETE forbidden (cancel/archive = status). Finance has NO raw '
  'SELECT (SI-12; v_finance_* later). Sensitivity: internal.';

create index idx_tasks_org_status_assignee on public.tasks (organization_id, status, assigned_to);
create index idx_tasks_org_reviewer_status on public.tasks (organization_id, reviewer_id, status);
create index idx_tasks_team on public.tasks (team_id);
create index idx_tasks_due_date on public.tasks (due_date);

create trigger trg_tasks_validate
  before insert or update on public.tasks
  for each row execute function public.validate_task_transition();

create trigger trg_tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create trigger trg_tasks_log_event
  after insert or update on public.tasks
  for each row execute function public.log_task_event();

create trigger trg_tasks_prevent_delete
  before delete on public.tasks
  for each row execute function public.prevent_delete();

-- Audit only the decision transitions (approve/reject) — not every lifecycle edit.
create trigger trg_audit_tasks
  after update on public.tasks
  for each row
  when (new.status is distinct from old.status and new.status in ('approved', 'rejected'))
  execute function public.log_audit();

-- =============================================================================
-- task_events (append-only status/submission history — AD4). Auto-written only.
-- =============================================================================
create table public.task_events (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  task_id               uuid not null,
  event_type            text not null,
  actor_id              uuid,
  from_status           text,
  to_status             text not null,
  submitted_at_snapshot timestamptz,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  constraint task_events_event_type_chk check (event_type in
    ('submitted','revision_requested','approved','rejected','assigned','cancelled','archived','status_change')),
  constraint task_events_task_org_fk
    foreign key (task_id, organization_id) references public.tasks (id, organization_id) on delete cascade,
  constraint task_events_actor_org_fk
    foreign key (organization_id, actor_id) references public.memberships (organization_id, profile_id)
);

comment on table public.task_events is
  'Append-only task status/submission history (doc 14 §198-207; AD4 source). Auto-written by log_task_event(); '
  'no client write path; UPDATE/DELETE forbidden. RLS read = task-viewers (+ Auditor via task visibility).';

create index idx_task_events_task_created on public.task_events (task_id, created_at);

create trigger trg_task_events_append_only
  before update or delete on public.task_events
  for each row execute function public.prevent_mutation();

-- =============================================================================
-- task_reviews (append-only reviewer decisions). INSERT drives the task transition.
-- =============================================================================
create table public.task_reviews (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null references public.organizations(id) on delete cascade,
  task_id                    uuid not null,
  reviewer_id                uuid not null,
  decision                   text not null,
  quality                    text not null,
  timeliness                 text not null,
  collaboration_score        text,                                 -- AD5: recorded, NOT scoring
  reviewer_note              text,
  timeliness_override_reason text,
  created_at                 timestamptz not null default now(),
  constraint task_reviews_decision_chk   check (decision in ('approve', 'needs_revision', 'reject')),
  constraint task_reviews_quality_chk    check (quality in ('poor', 'acceptable', 'good', 'excellent')),
  constraint task_reviews_timeliness_chk check (timeliness in ('early', 'on_time', 'late_minor', 'late_major')),
  -- D3: quality=poor cannot be approved.
  constraint task_reviews_approve_quality_chk check (decision <> 'approve' or quality <> 'poor'),
  constraint task_reviews_task_org_fk
    foreign key (task_id, organization_id) references public.tasks (id, organization_id) on delete cascade,
  constraint task_reviews_reviewer_org_fk
    foreign key (organization_id, reviewer_id) references public.memberships (organization_id, profile_id)
);

comment on table public.task_reviews is
  'Append-only reviewer decision (doc 16 §2). INSERT is the authoritative review action and drives the tasks '
  'transition (apply_review_to_task, Decision A). Self-approval hard block + own-team + submitted precondition '
  '(validate_task_review); D3 approve⇒quality<>poor (CHECK); collaboration_score is non-scoring (AD5). '
  'UPDATE/DELETE forbidden (new decision = new row). Finance excluded. Sensitivity: confidential.';

create index idx_task_reviews_task on public.task_reviews (task_id);
create index idx_task_reviews_reviewer on public.task_reviews (reviewer_id);

create trigger trg_task_reviews_validate
  before insert on public.task_reviews
  for each row execute function public.validate_task_review();

create trigger trg_task_reviews_apply
  after insert on public.task_reviews
  for each row execute function public.apply_review_to_task();

create trigger trg_audit_task_reviews
  after insert on public.task_reviews
  for each row execute function public.log_audit();

create trigger trg_task_reviews_append_only
  before update or delete on public.task_reviews
  for each row execute function public.prevent_mutation();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies
-- Finance has NO raw task/event/review SELECT (SI-12). task_events/task_reviews read
-- is gated by task visibility (RLS-filtered EXISTS on tasks). Reviews arrive via
-- task_reviews INSERT (task.review); task status changes flow through the definer
-- trigger, so reviewers need no direct tasks UPDATE for decisions.
-- =============================================================================
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
revoke all on public.tasks from anon, authenticated;
grant select, insert, update on public.tasks to authenticated;                    -- NO delete
grant all on public.tasks to service_role;

create policy tasks_select on public.tasks
  for select to authenticated
  using (
    public.has_support_grant(organization_id)                         -- support has no membership → top-level OR
    or (
      organization_id = public.current_org()
      and (
        assigned_to = auth.uid()
        or created_by = auth.uid()
        or reviewer_id = auth.uid()
        or public.manages_team(team_id)
        or public.has_role('hr') or public.has_role('admin')
        or public.has_role('owner') or public.has_role('auditor')
      )
    )
  );

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    organization_id = public.current_org()
    and public.has_permission('task.create')
    and (public.manages_team(team_id) or public.has_role('admin'))
  );

create policy tasks_update on public.tasks
  for update to authenticated
  using (
    organization_id = public.current_org()
    and (assigned_to = auth.uid() or public.manages_team(team_id)
         or public.has_role('hr') or public.has_role('admin') or public.has_role('owner'))
  )
  with check (
    organization_id = public.current_org()
    and (assigned_to = auth.uid() or public.manages_team(team_id)
         or public.has_role('hr') or public.has_role('admin') or public.has_role('owner'))
  );
-- No DELETE policy/privilege (prevent_delete + cancel/archive = status).

alter table public.task_events enable row level security;
alter table public.task_events force row level security;
revoke all on public.task_events from anon, authenticated;
grant select on public.task_events to authenticated;                              -- server/trigger writes only
grant all on public.task_events to service_role;

create policy task_events_select on public.task_events
  for select to authenticated
  using (
    -- Inherit task visibility: the inner select is itself RLS-filtered + org-joined,
    -- so support-granted / member viewers see exactly the events of tasks they can see.
    exists (
      select 1 from public.tasks t
      where t.id = task_events.task_id and t.organization_id = task_events.organization_id
    )
  );
-- No INSERT/UPDATE/DELETE policy (append-only, server-written).

alter table public.task_reviews enable row level security;
alter table public.task_reviews force row level security;
revoke all on public.task_reviews from anon, authenticated;
grant select, insert on public.task_reviews to authenticated;                     -- NO update/delete
grant all on public.task_reviews to service_role;

create policy task_reviews_select on public.task_reviews
  for select to authenticated
  using (
    -- Inherit task visibility (RLS-filtered + org-joined inner select).
    exists (
      select 1 from public.tasks t
      where t.id = task_reviews.task_id and t.organization_id = task_reviews.organization_id
    )
  );

create policy task_reviews_insert on public.task_reviews
  for insert to authenticated
  with check (
    organization_id = public.current_org()
    and public.has_permission('task.review')
    and reviewer_id = auth.uid()
  );
-- No UPDATE/DELETE policy (append-only; new decision = new row).
