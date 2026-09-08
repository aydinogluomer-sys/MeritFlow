-- =============================================================================
-- Migration 0043 — Policy Change Impact Ledger, slice 6-A: governance change requests.
-- Refs: implementation plan §8 (Module 6) — §8.2 (v7 published → draft v8; published NEVER mutated),
--       §8.7 (change request + HR/Finance approvals), §8.11 (retroactive effective date blocked if
--       policy forbids it); §2.6 (permission catalog); CLAUDE.md (RLS on every table; DB-sourced
--       authz AD1; every critical mutation audited); Decision Lock AD7. Local dev/staging only —
--       never production (ADR-014).
--
-- Scope (6-A ONLY): the structural-diff engine (pure TS) + this governance container.
--   * policy_change_requests: a MUTABLE state machine (draft → submitted → approved | rejected |
--     changes_requested; changes_requested → submitted) recording a proposed change FROM a published
--     scoring_policy_version TO a draft version, with DUAL HR + Finance approval stamped on the row.
--   * A validate trigger enforces the state machine, approval-slot integrity (HR stamps the HR slot,
--     Finance the Finance slot, one-time, self-stamped), version relationship (from=published /
--     to=draft / same policy+org — §8.2 published version is READ-ONLY here), and the retroactive
--     effective-date rule (§8.11). Approvals + decisions are AUDITED via log_audit().
--   * New permission policy.impact.read (view) — catalog 22 → 23. Approvals are ROLE-gated
--     (has_role('hr') AND has_role('finance') via two records) — NO new approve permission.
--
-- DELIBERATELY ABSENT (6-B / 6-C, gated): the backtest + pure scoring mirror, policy_change_impacts
-- append-only ledger, the P0 insight emission, and the UI page. NOTHING here writes to any ledger,
-- runs a calculation, or mutates a published scoring_policy_version. No edits to committed migrations.
-- =============================================================================

-- NOTE: the same-org COMPOSITE FK target on scoring_policy_versions — unique (id, organization_id),
-- named scoring_policy_versions_id_org_uq — ALREADY EXISTS (added by migration 0009; also relied on
-- by 0013/0019). policy_change_requests' composite FKs below resolve against it directly; adding it
-- again here would abort with "constraint ... already exists", so there is no ALTER in this slice.

-- -----------------------------------------------------------------------------
-- validate_policy_change_request(): the state machine + governance invariants (§8.2/§8.7/§8.11).
-- SECURITY DEFINER so it can read scoring_policy_versions (version relationship) regardless of RLS,
-- and so the guarantees also apply to bypassrls writers. Trusted context (auth.uid() IS NULL — server
-- job / seed) skips the ROLE checks but still obeys the state machine; authenticated callers are fully
-- gated (AD1: authz from DB roles, not ambient state). errcodes: 23514 (invalid transition/precondition),
-- 23001 (immutability), 42501 (insufficient role).
-- -----------------------------------------------------------------------------
create or replace function public.validate_policy_change_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_status text;
  v_from_policy uuid;
  v_from_org    uuid;
  v_to_status   text;
  v_to_policy   uuid;
  v_to_org      uuid;
begin
  -- Retroactive effective-date rule (§8.11): unless explicitly allowed, a PAST effective_date is
  -- rejected — but only re-checked when effective_date / allow_retroactive is set or changed, so a
  -- later approval UPDATE never fails merely because a valid future date has since arrived.
  if (tg_op = 'INSERT'
      or new.effective_date is distinct from old.effective_date
      or new.allow_retroactive is distinct from old.allow_retroactive)
     and not new.allow_retroactive
     and new.effective_date is not null
     and new.effective_date < current_date then
    raise exception 'retroactive effective_date % is not permitted (allow_retroactive=false)', new.effective_date
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    -- Clean start: a request is created in draft with no approvals/decision yet.
    if new.status <> 'draft' then
      raise exception 'policy change request must start in status draft (got %)', new.status using errcode = '23514';
    end if;
    if new.hr_approved_by is not null or new.finance_approved_by is not null
       or new.decided_at is not null then
      raise exception 'a new policy change request cannot be pre-approved/decided' using errcode = '23514';
    end if;

    -- Version relationship (§8.2): from=published, to=draft, both the SAME policy in the SAME org.
    -- (Composite FKs already guarantee each version is same-org; this adds published/draft + same-policy.)
    select spv.status, spv.scoring_policy_id, spv.organization_id
      into v_from_status, v_from_policy, v_from_org
      from public.scoring_policy_versions spv where spv.id = new.from_version_id;
    select spv.status, spv.scoring_policy_id, spv.organization_id
      into v_to_status, v_to_policy, v_to_org
      from public.scoring_policy_versions spv where spv.id = new.to_draft_version_id;

    if v_from_status is null or v_to_status is null then
      raise exception 'from/to scoring_policy_version does not exist' using errcode = '23503';
    end if;
    if v_from_status <> 'published' then
      raise exception 'from_version must be a PUBLISHED scoring_policy_version (got %)', v_from_status using errcode = '23514';
    end if;
    if v_to_status <> 'draft' then
      raise exception 'to_draft_version must be a DRAFT scoring_policy_version (got %)', v_to_status using errcode = '23514';
    end if;
    if v_from_policy <> new.scoring_policy_id or v_to_policy <> new.scoring_policy_id then
      raise exception 'both versions must belong to scoring_policy %', new.scoring_policy_id using errcode = '23514';
    end if;
    if v_from_org <> new.organization_id or v_to_org <> new.organization_id then
      raise exception 'both versions must belong to the request organization' using errcode = '23514';
    end if;

    return new;
  end if;

  -- ---- UPDATE ---------------------------------------------------------------------------------
  -- Identity is immutable once created.
  if new.organization_id   is distinct from old.organization_id
  or new.scoring_policy_id  is distinct from old.scoring_policy_id
  or new.from_version_id    is distinct from old.from_version_id
  or new.to_draft_version_id is distinct from old.to_draft_version_id
  or new.requested_by       is distinct from old.requested_by
  or new.created_at         is distinct from old.created_at then
    raise exception 'policy change request identity is immutable' using errcode = '23001';
  end if;

  -- Terminal states are frozen (changes_requested is NOT terminal — it can go back to submitted).
  if old.status in ('approved', 'rejected') then
    raise exception 'a % policy change request is immutable', old.status using errcode = '23001';
  end if;

  -- Approval-slot integrity: each slot is set once, by an actor holding that role, stamping SELF,
  -- only while the request is submitted. auth.uid() IS NULL = trusted server/seed (role check skipped).
  if new.hr_approved_by is distinct from old.hr_approved_by then
    if old.hr_approved_by is not null then
      raise exception 'hr approval cannot be changed once set' using errcode = '23001';
    end if;
    if old.status <> 'submitted' then
      raise exception 'hr approval requires a submitted request (status=%)', old.status using errcode = '23514';
    end if;
    if auth.uid() is not null then
      if not public.has_role('hr') then
        raise exception 'hr approval requires the hr role' using errcode = '42501';
      end if;
      if new.hr_approved_by <> auth.uid() then
        raise exception 'hr approver must stamp themselves' using errcode = '42501';
      end if;
    end if;
    new.hr_approved_at := now();
  end if;

  if new.finance_approved_by is distinct from old.finance_approved_by then
    if old.finance_approved_by is not null then
      raise exception 'finance approval cannot be changed once set' using errcode = '23001';
    end if;
    if old.status <> 'submitted' then
      raise exception 'finance approval requires a submitted request (status=%)', old.status using errcode = '23514';
    end if;
    if auth.uid() is not null then
      if not public.has_role('finance') then
        raise exception 'finance approval requires the finance role' using errcode = '42501';
      end if;
      if new.finance_approved_by <> auth.uid() then
        raise exception 'finance approver must stamp themselves' using errcode = '42501';
      end if;
    end if;
    new.finance_approved_at := now();
  end if;

  -- Auto-complete: once BOTH approvals are present on a submitted request, promote to approved.
  if new.status = old.status and old.status = 'submitted'
     and new.hr_approved_by is not null and new.finance_approved_by is not null then
    new.status := 'approved';
    new.decided_at := now();
  end if;

  -- Non-status update (e.g. an approval stamp that did not complete the pair, or a draft edit):
  -- allowed only while the request is still active.
  if new.status = old.status then
    if old.status not in ('draft', 'submitted', 'changes_requested') then
      raise exception 'no updates allowed in status %', old.status using errcode = '23514';
    end if;
    return new;
  end if;

  -- Allowed transitions.
  if not (
       (old.status = 'draft'              and new.status = 'submitted')
    or (old.status = 'submitted'          and new.status in ('approved', 'rejected', 'changes_requested'))
    or (old.status = 'changes_requested'  and new.status = 'submitted')
  ) then
    raise exception 'invalid policy change request transition: % -> %', old.status, new.status using errcode = '23514';
  end if;

  if new.status = 'approved' then
    -- Dual approval is mandatory (§8.7). (Normally reached via the auto-complete path above.)
    if new.hr_approved_by is null or new.finance_approved_by is null then
      raise exception 'approval requires BOTH hr and finance approvals' using errcode = '23514';
    end if;
    new.decided_at := now();
  elsif new.status in ('rejected', 'changes_requested') then
    if new.decision_note is null or length(btrim(new.decision_note)) = 0 then
      raise exception 'a % decision requires a decision_note', new.status using errcode = '23514';
    end if;
    -- Deciding (reject / request changes) is an approver action: HR or Finance (or trusted server).
    if auth.uid() is not null and not (public.has_role('hr') or public.has_role('finance')) then
      raise exception 'only hr or finance may reject / request changes' using errcode = '42501';
    end if;
    if new.status = 'rejected' then
      new.decided_at := now();
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_policy_change_request() is
  'Policy change request state machine + governance invariants (plan §8.2/§8.7/§8.11): version '
  'relationship (from=published/to=draft/same policy+org), one-time self-stamped HR/Finance approval '
  'slots, dual-approval gate, retroactive effective-date block. SECURITY DEFINER; trusted (auth.uid() '
  'null) skips role checks. Never mutates any scoring_policy_version.';

-- =============================================================================
-- policy_change_requests (mutable governance state machine). Confidential; audited.
-- =============================================================================
create table public.policy_change_requests (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  scoring_policy_id   uuid not null,
  from_version_id     uuid not null,               -- published version (READ-ONLY; never mutated — §8.2)
  to_draft_version_id uuid not null,               -- draft version proposed to replace it
  reason              text not null,
  status              text not null default 'draft',
  requested_by        uuid not null,               -- actor (memberships.profile_id)
  effective_date      date,                         -- optional; retroactive gated (§8.11)
  allow_retroactive   boolean not null default false,
  hr_approved_by      uuid,
  hr_approved_at      timestamptz,
  finance_approved_by uuid,
  finance_approved_at timestamptz,
  decided_at          timestamptz,
  decision_note       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint policy_change_requests_status_chk
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'changes_requested')),
  constraint policy_change_requests_reason_chk check (length(btrim(reason)) > 0),
  constraint policy_change_requests_decision_note_chk
    check (decision_note is null or length(btrim(decision_note)) > 0),
  constraint policy_change_requests_versions_distinct_chk
    check (from_version_id <> to_draft_version_id),
  -- Approval columns are internally consistent (by/at set together).
  constraint policy_change_requests_hr_pair_chk
    check ((hr_approved_by is null) = (hr_approved_at is null)),
  constraint policy_change_requests_finance_pair_chk
    check ((finance_approved_by is null) = (finance_approved_at is null)),
  -- Same-org composite FKs (SI-7): parent policy, both versions, and every actor are same-tenant.
  constraint policy_change_requests_policy_org_fk
    foreign key (scoring_policy_id, organization_id)
    references public.scoring_policies (id, organization_id) on delete cascade,
  constraint policy_change_requests_from_version_org_fk
    foreign key (from_version_id, organization_id)
    references public.scoring_policy_versions (id, organization_id),
  constraint policy_change_requests_to_version_org_fk
    foreign key (to_draft_version_id, organization_id)
    references public.scoring_policy_versions (id, organization_id),
  constraint policy_change_requests_requested_by_org_fk
    foreign key (organization_id, requested_by)
    references public.memberships (organization_id, profile_id),
  constraint policy_change_requests_hr_approver_org_fk
    foreign key (organization_id, hr_approved_by)
    references public.memberships (organization_id, profile_id),
  constraint policy_change_requests_finance_approver_org_fk
    foreign key (organization_id, finance_approved_by)
    references public.memberships (organization_id, profile_id)
);

comment on table public.policy_change_requests is
  'Policy Change Impact governance (plan §8.7): proposes replacing a PUBLISHED scoring_policy_version '
  '(from) with a DRAFT version (to). Mutable state machine draft→submitted→approved|rejected|'
  'changes_requested with DUAL HR+Finance approval (one-time, self-stamped, role-gated). Never mutates '
  'a published version (§8.2). Retroactive effective_date blocked unless allow_retroactive (§8.11). '
  'DELETE forbidden; audited. RLS read policy.impact.read; write policy.manage (create/submit) + '
  'HR/Finance (approve/decide). Sensitivity: confidential, audit-critical.';

create index idx_policy_change_requests_org_status
  on public.policy_change_requests (organization_id, status);
create index idx_policy_change_requests_policy
  on public.policy_change_requests (organization_id, scoring_policy_id);

create trigger trg_policy_change_requests_set_updated_at
  before update on public.policy_change_requests
  for each row execute function public.set_updated_at();

create trigger trg_policy_change_requests_validate
  before insert or update on public.policy_change_requests
  for each row execute function public.validate_policy_change_request();

create trigger trg_policy_change_requests_prevent_delete
  before delete on public.policy_change_requests
  for each row execute function public.prevent_delete();

create trigger trg_audit_policy_change_requests
  after insert or update on public.policy_change_requests
  for each row execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies.
--   read   : policy.impact.read holders (org-scoped).
--   insert : policy.manage holders create their own DRAFT request (requested_by = self).
--   update : policy.manage (submit / edit draft) OR HR/Finance (approve / decide) — fine-grained
--            integrity enforced by validate_policy_change_request(). No DELETE (prevent_delete belt).
-- =============================================================================
alter table public.policy_change_requests enable row level security;
alter table public.policy_change_requests force row level security;
revoke all on public.policy_change_requests from anon, authenticated;
grant select, insert, update on public.policy_change_requests to authenticated;  -- NO delete
grant all on public.policy_change_requests to service_role;

create policy policy_change_requests_select on public.policy_change_requests
  for select to authenticated
  using (organization_id = public.current_org() and public.has_permission('policy.impact.read'));

create policy policy_change_requests_insert on public.policy_change_requests
  for insert to authenticated
  with check (
    organization_id = public.current_org()
    and public.has_permission('policy.manage')
    and requested_by = auth.uid()
    and status = 'draft'
  );

create policy policy_change_requests_update on public.policy_change_requests
  for update to authenticated
  using (
    organization_id = public.current_org()
    and (public.has_permission('policy.manage') or public.has_role('hr') or public.has_role('finance'))
  )
  with check (
    organization_id = public.current_org()
    and (public.has_permission('policy.manage') or public.has_role('hr') or public.has_role('finance'))
  );
-- No DELETE policy / privilege; prevent_delete trigger is defense-in-depth.

-- =============================================================================
-- Permission catalog: add policy.impact.read (view). Catalog 22 → 23. Mirrors 0035/0042
-- (production-safe reference data; idempotent). Approvals are role-gated (has_role hr/finance) so
-- NO approve permission is added — dual approval is expressed by the two role-stamped slots.
-- =============================================================================
insert into public.permissions (key, label, domain, is_sensitive) values
  ('policy.impact.read', 'Read policy change impact', 'intelligence', false)
on conflict (key) do nothing;

-- Viewers/approvers: owner/admin (governance), hr + finance (approvers), auditor (oversight).
-- NOT manager, NOT employee.
insert into public.role_permissions (role_key, permission_key)
select r, 'policy.impact.read' from (values ('owner'), ('admin'), ('hr'), ('finance'), ('auditor')) as t(r)
on conflict (role_key, permission_key) do nothing;
