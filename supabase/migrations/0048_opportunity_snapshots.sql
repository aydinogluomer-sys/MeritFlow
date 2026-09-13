-- =============================================================================
-- Migration 0048 — Opportunity-to-Perform Intelligence, slice 2-A: opportunity snapshot store.
-- Refs: implementation_product_9_modules §4.2 (forbidden approach), §4.3 (decomposed index), §4.4
--       (data model), §4.5 (cohort + normalization), §4.6 (flags), §17 (small-cohort suppression),
--       §26 (Opportunity gate: NO protected-attribute pay decision); CLAUDE.md (no surveillance;
--       privacy/legal guardrails); AD9 (primary team = team_memberships.is_primary); D10 (≥15 days).
--       Local dev/staging only (ADR-014).
--
-- Scope (2-A): opportunity_snapshots — an APPEND-ONLY, reproducible, DECOMPOSED opportunity evaluation
-- of an (employee, bonus_period). Computed ONLY from work-context signals (assigned/eligible/completed
-- work, complexity mix, review latency, active days) — NEVER a protected characteristic and NEVER
-- compensation (§4.2). opportunity_index is a TRANSPARENT weighted aggregate of decomposed component
-- sub-scores (components jsonb) — no opaque ML (§26); NULL when the cohort is suppressed (< min sample
-- / no active window, §4.5/§17). ADVISORY: drives NO pay/ledger/policy change; flags say "Investigate".
-- RLS: employee-own + MANAGER of the employee's PRIMARY team (no cross-team leakage) + HR/owner/admin/
-- auditor org-wide (clones the point_ledger three-tier policy). Server-only writes; append-only
-- IMMUTABLE (prevent_mutation) + unique(employee_id, bonus_period_id, rule_set_version); audited. No new
-- SECURITY DEFINER function (reuses current_org/has_role/manages_team/team_of/has_support_grant/
-- prevent_mutation/log_audit). NO protected-attribute columns; NO compensation columns. DELIBERATELY
-- ABSENT (2-B): UI / scatter / manager view / exception routing.
-- =============================================================================

create table public.opportunity_snapshots (
  id                            uuid primary key default gen_random_uuid(),
  organization_id               uuid not null references public.organizations(id) on delete cascade,
  employee_id                   uuid not null,                 -- the evaluated member (memberships.profile_id)
  bonus_period_id               uuid not null,                 -- the evaluation period
  rule_set_version              text not null,                 -- tags the rule set (bump → new reproducible row)
  eligible_work_count           integer not null,              -- the employee's PRIMARY-team task pool in the period
  assigned_work_count           integer not null,              -- tasks assigned to the employee in the period
  completed_work_count          integer not null,              -- the employee's approved/rejected tasks in the period
  complexity_weighted_available numeric not null,              -- team pool, complexity-weighted
  complexity_weighted_assigned  numeric not null,              -- employee's assigned work, complexity-weighted
  active_days                   integer not null,              -- bonus_pool_eligibility.days_active (D10)
  review_latency_p50            numeric,                       -- median days submitted→review (NULL if no signal)
  opportunity_index             numeric,                       -- 0–100 transparent aggregate; NULL when suppressed
  components                    jsonb not null,                -- { items[], weights[], flags[], cohort*, suppressed }
  computed_at                   timestamptz not null default now(),
  created_at                    timestamptz not null default now(),
  constraint opportunity_snapshots_rule_set_chk check (length(btrim(rule_set_version)) > 0),
  constraint opportunity_snapshots_counts_chk
    check (eligible_work_count >= 0 and assigned_work_count >= 0 and completed_work_count >= 0
           and active_days >= 0
           and complexity_weighted_available >= 0 and complexity_weighted_assigned >= 0),
  constraint opportunity_snapshots_index_range_chk
    check (opportunity_index is null or (opportunity_index >= 0 and opportunity_index <= 100)),
  constraint opportunity_snapshots_latency_chk
    check (review_latency_p50 is null or review_latency_p50 >= 0),
  -- The decomposed breakdown is a structured object (items + weights + flags) — never opaque (§26).
  constraint opportunity_snapshots_components_object_chk check (jsonb_typeof(components) = 'object'),
  -- Reproducibility: exactly one snapshot per (employee, period, rule set version).
  constraint opportunity_snapshots_employee_period_ruleset_uq
    unique (employee_id, bonus_period_id, rule_set_version),
  -- Same-org composite FKs (SI-7): the member and the period are same-tenant.
  constraint opportunity_snapshots_employee_org_fk
    foreign key (organization_id, employee_id)
    references public.memberships (organization_id, profile_id),
  constraint opportunity_snapshots_period_org_fk
    foreign key (bonus_period_id, organization_id)
    references public.bonus_periods (id, organization_id)
);

comment on table public.opportunity_snapshots is
  'Opportunity-to-Perform Intelligence (Module 2-A, §4.4). Append-only, reproducible, DECOMPOSED '
  'opportunity evaluation of an (employee, bonus_period) from WORK-CONTEXT signals ONLY (no protected '
  'characteristic, no compensation — §4.2/§26). opportunity_index is a TRANSPARENT weighted aggregate '
  'of the component sub-scores in `components` (no opaque ML); NULL when the cohort is suppressed '
  '(< min sample / no active window — §4.5/§17). ADVISORY: drives no pay/ledger/policy change; flags '
  'say "Investigate". RLS: employee-own + manager of the employee''s PRIMARY team (no cross-team '
  'leakage) + HR/owner/admin/auditor org. Server-only writes; UPDATE/DELETE blocked; audited. '
  'Sensitivity: confidential.';
comment on column public.opportunity_snapshots.components is
  'Transparent decomposition { items: OpportunityComponent[] (code, label, score, drivers[]), '
  'weights: [], flags: OpportunityFlag[], cohortKey, cohortSize, suppressed, suppressionReason }. '
  'opportunity_index is re-derivable from items+weights — no opaque score (§26/§4.3).';

create index idx_opportunity_snapshots_org_period
  on public.opportunity_snapshots (organization_id, bonus_period_id);
create index idx_opportunity_snapshots_org_employee
  on public.opportunity_snapshots (organization_id, employee_id);

-- Append-only: block UPDATE and DELETE (a snapshot is immutable + reproducible).
create trigger trg_opportunity_snapshots_immutable
  before update or delete on public.opportunity_snapshots
  for each row execute function public.prevent_mutation();

-- Audit on creation (append-only ⇒ only INSERT fires).
create trigger trg_audit_opportunity_snapshots
  after insert on public.opportunity_snapshots
  for each row execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants. Read = employee-own OR manager-of-their-PRIMARY-team
-- (team_memberships.is_primary via team_of + manages_team — NO cross-team leakage) OR HR/owner/admin/
-- auditor org-wide (clones the point_ledger 0009 three-tier policy). Writes SERVER-ONLY (service_role):
-- the engine runs in TS and writes via the admin client. No INSERT/UPDATE/DELETE policy for
-- authenticated; immutability enforced by the trigger above.
-- =============================================================================
alter table public.opportunity_snapshots enable row level security;
alter table public.opportunity_snapshots force row level security;
revoke all on public.opportunity_snapshots from anon, authenticated;
grant select on public.opportunity_snapshots to authenticated;  -- read only; no client writes
grant all on public.opportunity_snapshots to service_role;

create policy opportunity_snapshots_select on public.opportunity_snapshots
  for select to authenticated
  using (
    public.has_support_grant(organization_id)
    or (
      organization_id = public.current_org()
      and (
        employee_id = auth.uid()
        or public.manages_team(public.team_of(employee_id))
        or public.has_role('owner')
        or public.has_role('admin')
        or public.has_role('hr')
        or public.has_role('auditor')
      )
    )
  );
-- No INSERT/UPDATE/DELETE policy → server-only writes; append-only immutability via the trigger.
