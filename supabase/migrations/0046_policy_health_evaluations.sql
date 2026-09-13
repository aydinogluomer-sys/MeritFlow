-- =============================================================================
-- Migration 0046 — Incentive Health Engine, slice 1-A: health evaluation store.
-- Refs: implementation_product_9_modules §3.2 (dimensions), §3.3 (score contract: sub-scores
--       mandatory), §3.4 (score/confidence/drivers/evidence), §3.5 (versioned rules), §3.6 (data
--       model: reproducible versioned evaluation), §12.4 (Complexity feeds Health), §26 (Health gate:
--       NO OPAQUE SCORE); CLAUDE.md (RLS every table; append-only analytical history; audit); AD7
--       (published scoring versions immutable — read-only here). Local dev/staging only (ADR-014).
--
-- Scope (1-A): policy_health_evaluations — a reproducible, APPEND-ONLY record of a DETERMINISTIC
-- incentive-health evaluation of a scoring_policy_version (the engine lives in TS:
-- src/modules/incentive-health/domain/**). overall_score is a TRANSPARENT weighted aggregate of the
-- per-dimension sub-scores; the full breakdown (each dimension's sub-score + confidence + transparent
-- drivers + evidence, plus the exact weights used) lives in the `dimensions` jsonb — never an opaque
-- number (§26/§3.3). Keyed uniquely by (policy_version_id, rule_set_version) so the same evaluation is
-- reproducible and never silently overwritten. Writes are SERVER-ONLY (service_role); read =
-- policy.manage (NO new permission — catalog stays 23). NOTHING here mutates scoring_policy_versions,
-- any ledger, or triggers a bonus calculation (§26 — reads only). No new SECURITY DEFINER function
-- (reuses prevent_mutation + log_audit). DELIBERATELY ABSENT: risk-acceptance workflow (1-B),
-- policy comparison (1-B), UI (1-C).
-- =============================================================================

create table public.policy_health_evaluations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  policy_version_id  uuid not null,                 -- the analyzed scoring_policy_version (READ-ONLY; §26)
  rule_set_version  text not null,                 -- tags the rule set (bump → new reproducible row)
  overall_score     numeric not null,               -- transparent weighted aggregate of the sub-scores
  dimensions        jsonb not null,                 -- { items: DimensionScore[], weights: [], deferred: [] }
  evaluated_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint policy_health_evaluations_rule_set_chk check (length(btrim(rule_set_version)) > 0),
  -- Health sub-scores + overall live in the range 0–100 (§3.3).
  constraint policy_health_evaluations_overall_score_chk
    check (overall_score >= 0 and overall_score <= 100),
  -- The breakdown is a structured object (items/weights/deferred) — never opaque (§26).
  constraint policy_health_evaluations_dimensions_object_chk
    check (jsonb_typeof(dimensions) = 'object'),
  -- Reproducibility: exactly one evaluation per (policy version, rule set version).
  constraint policy_health_evaluations_version_ruleset_uq
    unique (policy_version_id, rule_set_version),
  -- Same-org composite FK (SI-7): the analyzed version is same-tenant (target unique added in 0009).
  constraint policy_health_evaluations_version_org_fk
    foreign key (policy_version_id, organization_id)
    references public.scoring_policy_versions (id, organization_id)
);

comment on table public.policy_health_evaluations is
  'Incentive Health Engine (Module 1-A, §3.6). Append-only, reproducible DETERMINISTIC health '
  'evaluation of a scoring_policy_version: a transparent weighted overall_score over per-dimension '
  'sub-scores (financial integrity, payout concentration, gaming resistance, manager discretion, '
  'dispute exposure, complexity). Keyed by (policy_version_id, rule_set_version). READ-ONLY on the '
  'policy — drives no financial calc, mutates no ledger (§26). UPDATE/DELETE blocked; audited. RLS '
  'read policy.manage; server-only writes. Sensitivity: confidential.';
comment on column public.policy_health_evaluations.dimensions is
  'Transparent breakdown { items: DimensionScore[] (dimension, score, confidence, drivers[], '
  'evidence[]), weights: HealthWeight[], deferred: string[] }. overall_score is re-derivable from '
  'items+weights — no opaque aggregate (§26/§3.3/§3.4).';

create index idx_policy_health_evaluations_org_version
  on public.policy_health_evaluations (organization_id, policy_version_id);

-- Append-only: block UPDATE and DELETE (an evaluation is immutable and reproducible).
create trigger trg_policy_health_evaluations_immutable
  before update or delete on public.policy_health_evaluations
  for each row execute function public.prevent_mutation();

-- Audit on creation (append-only ⇒ only INSERT fires).
create trigger trg_audit_policy_health_evaluations
  after insert on public.policy_health_evaluations
  for each row execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants. Read = policy.manage (org-scoped). Writes are
-- SERVER-ONLY (service_role): the engine runs in TS and writes via the admin client (same posture as
-- policy_complexity_evaluations). No INSERT/UPDATE/DELETE policy for authenticated; immutability
-- enforced by the trigger above (even vs a bypassrls writer).
-- =============================================================================
alter table public.policy_health_evaluations enable row level security;
alter table public.policy_health_evaluations force row level security;
revoke all on public.policy_health_evaluations from anon, authenticated;
grant select on public.policy_health_evaluations to authenticated;  -- read only; no client writes
grant all on public.policy_health_evaluations to service_role;

create policy policy_health_evaluations_select on public.policy_health_evaluations
  for select to authenticated
  using (organization_id = public.current_org() and public.has_permission('policy.manage'));
-- No INSERT/UPDATE/DELETE policy → server-only writes; append-only immutability via the trigger.
