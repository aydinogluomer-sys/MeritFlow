-- =============================================================================
-- Migration 0008 — Scoring policies & immutable policy versions  (Phase 3B-A)
-- Refs: 18_PHASE_3B... §5.1/§5.2/§5.5/§6, 14_DATA_DICTIONARY (Scoring),
--       15_RLS_POLICY_MATRIX (scoring_policies/versions), 16 (AD7/SI-4/SI-14),
--       ADR-005/ADR-012/ADR-020, Decision Lock AD7.
--
-- Scope (Phase 3B-A ONLY): scoring_policies + scoring_policy_versions, their
-- RLS (ENABLE + FORCE) + least-privilege grants + policies, the published-version
-- immutability trigger, and audit. NO point_ledger, NO team_of(), NO tasks/bonus.
--
-- Patterns reused from Phase 3A:
--   * set_updated_at() / log_audit() / RLS helpers (current_org, has_permission,
--     has_support_grant) created in 0001/0005/0006.
--   * RLS ENABLED + FORCE; org-anchored policies (SI-6/SI-7); authenticated never
--     granted DELETE; service_role is the trusted writer (§6).
--   * Authorization read from DB via has_permission('policy.manage') (AD1/ADR-012).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- prevent_published_scoring_policy_version_mutation():
--   CONDITIONAL immutability (AD7/SI-4/SI-14). Unlike the blanket prevent_mutation(),
--   this blocks UPDATE/DELETE ONLY when the existing row is already 'published';
--   draft rows stay editable and the draft -> published transition is allowed.
--   SECURITY DEFINER so the block also applies to bypassrls roles. Stable message
--   per tg_op for strict pgTAP assertions; errcode restrict_violation (23001).
-- -----------------------------------------------------------------------------
create or replace function public.prevent_published_scoring_policy_version_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'published' then
    raise exception 'immutable: % on published scoring_policy_versions is not permitted', tg_op
      using errcode = 'restrict_violation';
  end if;
  -- Not published yet: allow. (draft edits, and draft -> published.)
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.prevent_published_scoring_policy_version_mutation() is
  'Conditional immutability: blocks UPDATE/DELETE of a PUBLISHED scoring_policy_versions '
  'row (AD7/SI-4); allows draft edits and draft->published. SECURITY DEFINER.';

-- -----------------------------------------------------------------------------
-- scoring_policies (tenant-scoped logical policy; 1—* versions)
-- -----------------------------------------------------------------------------
create table public.scoring_policies (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  status          text not null default 'draft',
  description     text,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint scoring_policies_status_chk check (status in ('draft', 'active', 'archived')),
  constraint scoring_policies_org_name_uq unique (organization_id, name),
  -- Composite-unique so scoring_policy_versions can target (id, organization_id)
  -- with a composite FK and guarantee same-org integrity (§5.5 decision 7).
  constraint scoring_policies_id_org_uq unique (id, organization_id)
);

comment on table public.scoring_policies is
  'Logical scoring policy (1-* versions). Tenant-scoped. Sensitivity: confidential. '
  'Writes require has_permission(policy.manage). Audited.';

-- (organization_id) lead is also covered by scoring_policies_org_name_uq; created
-- explicitly per the data dictionary / plan, plus (organization_id, status).
create index idx_scoring_policies_org on public.scoring_policies (organization_id);
create index idx_scoring_policies_org_status on public.scoring_policies (organization_id, status);

create trigger trg_scoring_policies_updated_at
  before update on public.scoring_policies
  for each row execute function public.set_updated_at();

create trigger trg_audit_scoring_policies
  after insert or update or delete on public.scoring_policies
  for each row execute function public.log_audit();

-- -----------------------------------------------------------------------------
-- scoring_policy_versions (immutable once PUBLISHED — AD7)
--   organization_id integrity is enforced via the COMPOSITE FK to
--   scoring_policies(id, organization_id): a version cannot belong to a different
--   tenant than its parent policy. (No separate org FK needed; the parent is
--   itself org-anchored to organizations.)
-- -----------------------------------------------------------------------------
create table public.scoring_policy_versions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  scoring_policy_id     uuid not null,
  version_no            int  not null,
  status                text not null default 'draft',
  multipliers           jsonb not null,
  revision_penalty_rule jsonb not null,
  timeliness_thresholds jsonb not null,
  notes                 text,
  published_at          timestamptz,
  published_by          uuid references public.profiles(id),
  created_by            uuid not null references public.profiles(id),
  created_at            timestamptz not null default now(),
  constraint scoring_policy_versions_status_chk check (status in ('draft', 'published')),
  constraint scoring_policy_versions_policy_version_uq unique (scoring_policy_id, version_no),
  -- A published version must record who/when it was published.
  constraint scoring_policy_versions_published_chk
    check (status <> 'published' or (published_at is not null and published_by is not null)),
  -- Same-org integrity (§5.5 decision 7): version's (policy, org) must match a
  -- scoring_policies (id, organization_id) pair -> cross-org pairing impossible.
  constraint scoring_policy_versions_policy_org_fk
    foreign key (scoring_policy_id, organization_id)
    references public.scoring_policies (id, organization_id) on delete cascade
);

comment on table public.scoring_policy_versions is
  'Immutable published policy snapshot (multipliers/thresholds/penalty rule; locked '
  'per AD7). Same-org integrity via composite FK. Sensitivity: confidential, audit-critical.';

create index idx_scoring_policy_versions_org on public.scoring_policy_versions (organization_id);
-- (scoring_policy_id, version_no) index is provided by scoring_policy_versions_policy_version_uq.

create trigger trg_scoring_policy_versions_immutable
  before update or delete on public.scoring_policy_versions
  for each row execute function public.prevent_published_scoring_policy_version_mutation();

create trigger trg_audit_scoring_policy_versions
  after insert or update or delete on public.scoring_policy_versions
  for each row execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies  (same slice — §6)
-- =============================================================================

-- ----------------------------- scoring_policies ------------------------------
alter table public.scoring_policies enable row level security;
alter table public.scoring_policies force row level security;
revoke all on public.scoring_policies from anon, authenticated;
grant select, insert, update on public.scoring_policies to authenticated;  -- no DELETE
grant all on public.scoring_policies to service_role;

create policy scoring_policies_select on public.scoring_policies
  for select to authenticated
  using (organization_id = public.current_org() or public.has_support_grant(organization_id));

create policy scoring_policies_insert on public.scoring_policies
  for insert to authenticated
  with check (organization_id = public.current_org() and public.has_permission('policy.manage'));

create policy scoring_policies_update on public.scoring_policies
  for update to authenticated
  using (organization_id = public.current_org() and public.has_permission('policy.manage'))
  with check (organization_id = public.current_org() and public.has_permission('policy.manage'));
-- DELETE: no policy, no privilege (soft lifecycle = status).

-- -------------------------- scoring_policy_versions --------------------------
alter table public.scoring_policy_versions enable row level security;
alter table public.scoring_policy_versions force row level security;
revoke all on public.scoring_policy_versions from anon, authenticated;
grant select, insert, update on public.scoring_policy_versions to authenticated;  -- no DELETE
grant all on public.scoring_policy_versions to service_role;

create policy scoring_policy_versions_select on public.scoring_policy_versions
  for select to authenticated
  using (organization_id = public.current_org() or public.has_support_grant(organization_id));

create policy scoring_policy_versions_insert on public.scoring_policy_versions
  for insert to authenticated
  with check (organization_id = public.current_org() and public.has_permission('policy.manage'));

create policy scoring_policy_versions_update on public.scoring_policy_versions
  for update to authenticated
  using (organization_id = public.current_org() and public.has_permission('policy.manage'))
  with check (organization_id = public.current_org() and public.has_permission('policy.manage'));
-- DELETE: no policy, no privilege. Published immutability also enforced by
-- trg_scoring_policy_versions_immutable (defense-in-depth).
