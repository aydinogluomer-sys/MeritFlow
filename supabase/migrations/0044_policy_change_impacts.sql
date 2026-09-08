-- =============================================================================
-- Migration 0044 — Policy Change Impact Ledger, slice 6-B: the append-only impact artifact.
-- Refs: implementation plan §8.4 (impact simulation), §8.5 (impact summary), §8.6 (behavioral impact),
--       §8.8 (impact ledger); §2.3/§2.4 (evidence envelope / insight store); §26 (Change Impact gate:
--       published version NEVER mutated); CLAUDE.md (RLS every table; append-only artifacts; audit);
--       Decision Lock AD7. Local dev/staging only — never production (ADR-014).
--
-- Scope (6-B): policy_change_impacts — an IMMUTABLE, append-only advisory artifact recording the
-- result of a deterministic backtest (re-score a frozen reference period's approved work under
-- from_version vs to_draft_version, then run the REUSED pure allocateBonus engine; §8.5 summary). The
-- backtest + insight emission are computed SERVER-SIDE in TS (application layer) — this migration only
-- provides the storage container with its guarantees. NOTHING here writes any ledger, runs a
-- calculation, or mutates a published scoring_policy_version. health_delta / complexity_delta are
-- present but NULL this slice (§8.6 — Complexity later, Health P2). No new permission (catalog 23):
-- read = policy.impact.read; writes are SERVER-ONLY (service_role), like bonus_allocation_snapshots /
-- intelligence_insights. No edits to committed migrations. DELIBERATELY ABSENT: 6-C UI, communication
-- preview, health/complexity engines.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Same-org COMPOSITE FK target on policy_change_requests. 0043 gave the table PK(id) but NO
-- unique(id, organization_id); the impact→request composite FK below needs that exact unique. This is
-- NET-NEW (verified: no earlier migration adds it) — additive, changes no existing semantics.
-- -----------------------------------------------------------------------------
alter table public.policy_change_requests
  add constraint policy_change_requests_id_org_uq unique (id, organization_id);

-- =============================================================================
-- policy_change_impacts (append-only, IMMUTABLE advisory artifact). Confidential; audited.
-- =============================================================================
create table public.policy_change_impacts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  change_request_id     uuid not null,                 -- the governance request this simulates
  reference_period_id   uuid not null,                 -- FROZEN historical dataset identity (locked period)
  impact_version        int  not null default 1,       -- re-simulations bump this (§8.8)
  from_version_id       uuid not null,                 -- published version (read-only; §8.2)
  to_draft_version_id   uuid not null,                 -- proposed draft version
  financial_impact      jsonb not null,                -- §8.5 summary (affected/higher/lower/unchanged/budget/median/max-neg)
  employee_distribution jsonb not null,                -- per-employee { employeeId, fromMinor, toMinor, deltaMinor }[]
  health_delta          jsonb,                          -- §8.6 — NULL this slice (Health = P2)
  complexity_delta      jsonb,                          -- §8.6 — NULL this slice (Complexity = later)
  generated_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  constraint policy_change_impacts_versions_distinct_chk
    check (from_version_id <> to_draft_version_id),
  constraint policy_change_impacts_impact_version_chk check (impact_version >= 1),
  -- §8.5 summary is an object; the per-employee distribution is an array (evidence-envelope discipline).
  constraint policy_change_impacts_financial_object_chk
    check (jsonb_typeof(financial_impact) = 'object'),
  constraint policy_change_impacts_distribution_array_chk
    check (jsonb_typeof(employee_distribution) = 'array'),
  -- one artifact per (request, impact_version).
  constraint policy_change_impacts_request_version_uq unique (change_request_id, impact_version),
  -- Same-org composite FKs (SI-7): request, reference period, and both versions are same-tenant.
  constraint policy_change_impacts_request_org_fk
    foreign key (change_request_id, organization_id)
    references public.policy_change_requests (id, organization_id) on delete cascade,
  constraint policy_change_impacts_period_org_fk
    foreign key (reference_period_id, organization_id)
    references public.bonus_periods (id, organization_id),
  constraint policy_change_impacts_from_version_org_fk
    foreign key (from_version_id, organization_id)
    references public.scoring_policy_versions (id, organization_id),
  constraint policy_change_impacts_to_version_org_fk
    foreign key (to_draft_version_id, organization_id)
    references public.scoring_policy_versions (id, organization_id)
);

comment on table public.policy_change_impacts is
  'Append-only IMMUTABLE Policy Change Impact artifact (plan §8.8). Records a DETERMINISTIC backtest '
  '(re-score a locked reference period under from_version vs to_draft_version, then the pure '
  'allocateBonus engine) → §8.5 financial_impact summary + per-employee employee_distribution. Advisory: '
  'NOT a ledger; no ledger write, no run_bonus_calculation, no published-version mutation. '
  'health_delta/complexity_delta NULL this slice (§8.6). UPDATE/DELETE blocked; audited. RLS read '
  'policy.impact.read; server-only writes. Sensitivity: confidential, audit-critical.';
comment on column public.policy_change_impacts.reference_period_id is
  'The frozen historical dataset (a locked bonus_period). With (change_request, from/to version) it is '
  'the reproducible identity: append-only inputs → re-run yields an identical result.';

create index idx_policy_change_impacts_org_request
  on public.policy_change_impacts (organization_id, change_request_id);
create index idx_policy_change_impacts_org_period
  on public.policy_change_impacts (organization_id, reference_period_id);

-- Append-only: block UPDATE and DELETE entirely (immutable artifact — like bonus_allocation_snapshots).
create trigger trg_policy_change_impacts_immutable
  before update or delete on public.policy_change_impacts
  for each row execute function public.prevent_mutation();

-- Audit on creation (append-only ⇒ only INSERT fires; UPDATE/DELETE are blocked above).
create trigger trg_audit_policy_change_impacts
  after insert on public.policy_change_impacts
  for each row execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies. Read = policy.impact.read (org-scoped).
-- Writes are SERVER-ONLY (service_role): the backtest is computed in TS and written via the admin
-- client (same posture as intelligence_insights / bonus_allocation_snapshots). No INSERT/UPDATE/DELETE
-- policy or privilege for authenticated. Immutability enforced by the trigger above (even vs writers).
-- =============================================================================
alter table public.policy_change_impacts enable row level security;
alter table public.policy_change_impacts force row level security;
revoke all on public.policy_change_impacts from anon, authenticated;
grant select on public.policy_change_impacts to authenticated;  -- read only; no client writes
grant all on public.policy_change_impacts to service_role;

create policy policy_change_impacts_select on public.policy_change_impacts
  for select to authenticated
  using (organization_id = public.current_org() and public.has_permission('policy.impact.read'));
-- No INSERT/UPDATE/DELETE policy → server-only writes; append-only immutability via the trigger.
