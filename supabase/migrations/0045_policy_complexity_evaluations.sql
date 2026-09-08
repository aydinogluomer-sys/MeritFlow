-- =============================================================================
-- Migration 0045 — Policy Debt / Complexity Meter, slice 4-A: static-complexity evaluation store.
-- Refs: implementation plan §6.2 (complexity components), §6.3 (score + transparent drivers), §6.4
--       (static complexity), §6.9 (data model), §3.5 (versioned rules), §26 (Policy Debt gate: NO
--       policy mutation); CLAUDE.md (RLS every table; append-only analytical history; audit); AD7
--       (published scoring versions immutable — read-only here). Local dev/staging only (ADR-014).
--
-- Scope (4-A): policy_complexity_evaluations — a reproducible, APPEND-ONLY record of a DETERMINISTIC
-- static-complexity evaluation of a scoring_policy_version (the engine lives in TS:
-- src/modules/policy-complexity/domain/complexity-rules.ts). The score decomposes into transparent
-- per-component drivers (components jsonb) — no opaque aggregate. runtime_score is NULL this slice
-- (runtime complexity = 4-B); total_score = static_score for now. Keyed uniquely by
-- (policy_version_id, rule_set_version) so the same evaluation is reproducible and never silently
-- overwritten. Writes are SERVER-ONLY (service_role); read = policy.manage (NO new permission —
-- catalog stays 23). NOTHING here mutates scoring_policy_versions or any policy (§26). No new SECURITY
-- DEFINER function (reuses prevent_mutation + log_audit). DELIBERATELY ABSENT (4-B): runtime
-- complexity, debt total (§6.6), version trend (§6.7), simplification candidates (§6.8), UI.
-- =============================================================================

create table public.policy_complexity_evaluations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  policy_version_id  uuid not null,                 -- the analyzed scoring_policy_version (READ-ONLY; §26)
  rule_set_version  text not null,                 -- tags the rule set (bump → new reproducible row)
  static_score      numeric not null,
  runtime_score     numeric,                        -- NULL this slice (runtime complexity = 4-B)
  total_score       numeric not null,               -- = static_score until 4-B adds runtime
  components        jsonb not null,                 -- transparent drivers (ComplexityDriver[])
  evaluated_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint policy_complexity_evaluations_rule_set_chk check (length(btrim(rule_set_version)) > 0),
  constraint policy_complexity_evaluations_static_score_chk check (static_score >= 0),
  constraint policy_complexity_evaluations_total_score_chk check (total_score >= 0),
  constraint policy_complexity_evaluations_runtime_score_chk
    check (runtime_score is null or runtime_score >= 0),
  constraint policy_complexity_evaluations_components_array_chk
    check (jsonb_typeof(components) = 'array'),
  -- Reproducibility: exactly one evaluation per (policy version, rule set version).
  constraint policy_complexity_evaluations_version_ruleset_uq
    unique (policy_version_id, rule_set_version),
  -- Same-org composite FK (SI-7): the analyzed version is same-tenant (target unique added in 0009).
  constraint policy_complexity_evaluations_version_org_fk
    foreign key (policy_version_id, organization_id)
    references public.scoring_policy_versions (id, organization_id)
);

comment on table public.policy_complexity_evaluations is
  'Policy Debt / Complexity Meter (Module 4-A, plan §6.9). Append-only, reproducible DETERMINISTIC '
  'static-complexity evaluation of a scoring_policy_version: static_score + transparent per-component '
  'drivers (components). runtime_score NULL this slice (4-B); total_score = static_score for now. '
  'Keyed by (policy_version_id, rule_set_version). READ-ONLY on the policy (§26 — no mutation). '
  'UPDATE/DELETE blocked; audited. RLS read policy.manage; server-only writes. Sensitivity: confidential.';
comment on column public.policy_complexity_evaluations.components is
  'Transparent complexity drivers (ComplexityDriver[]): { code, label, impact, value, threshold? }. '
  'Every point of static_score traces to a driver — no opaque aggregate (§6.3).';

create index idx_policy_complexity_evaluations_org_version
  on public.policy_complexity_evaluations (organization_id, policy_version_id);

-- Append-only: block UPDATE and DELETE (an evaluation is immutable and reproducible).
create trigger trg_policy_complexity_evaluations_immutable
  before update or delete on public.policy_complexity_evaluations
  for each row execute function public.prevent_mutation();

-- Audit on creation (append-only ⇒ only INSERT fires).
create trigger trg_audit_policy_complexity_evaluations
  after insert on public.policy_complexity_evaluations
  for each row execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants. Read = policy.manage (org-scoped). Writes are
-- SERVER-ONLY (service_role): the engine runs in TS and writes via the admin client (same posture as
-- policy_change_impacts / intelligence_insights). No INSERT/UPDATE/DELETE policy for authenticated;
-- immutability enforced by the trigger above (even vs a bypassrls writer).
-- =============================================================================
alter table public.policy_complexity_evaluations enable row level security;
alter table public.policy_complexity_evaluations force row level security;
revoke all on public.policy_complexity_evaluations from anon, authenticated;
grant select on public.policy_complexity_evaluations to authenticated;  -- read only; no client writes
grant all on public.policy_complexity_evaluations to service_role;

create policy policy_complexity_evaluations_select on public.policy_complexity_evaluations
  for select to authenticated
  using (organization_id = public.current_org() and public.has_permission('policy.manage'));
-- No INSERT/UPDATE/DELETE policy → server-only writes; append-only immutability via the trigger.
