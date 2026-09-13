-- =============================================================================
-- Migration 0047 — Incentive Health Engine, slice 1-B: risk-acceptance (waiver) store.
-- Refs: implementation_product_9_modules §3.4 (drivers), §3.8 (Accept Risk workflow: Risk → Review →
--       Accept Risk → reason required → actor → timestamp → expiry optional), §3.11 (risk acceptance
--       audit + comparison to previous policy), §2.7 (audit: policy risk waiver), §26 (Health gate:
--       no opaque score, no mutation); CLAUDE.md (RLS every table; append-only governance history;
--       audit); AD7 (published scoring versions immutable — read-only here). Local dev/staging only
--       (ADR-014).
--
-- Scope (1-B): policy_health_risk_acceptances — an APPEND-ONLY, AUDITED record that a policy owner has
-- explicitly ACCEPTED a specific risk driver of a health evaluation, with a mandatory reason + actor +
-- server timestamp (+ optional expiry). A risk is NEVER silently dismissed (§3.8): the only lifecycle
-- is accept-with-reason, and it expires via expires_at. Accepting a risk does NOT change the computed
-- health score, does NOT mutate a policy (§26/AD7), and writes NO ledger. Unlike the server-only 0046
-- writes, this is a USER action: authenticated INSERT gated by RLS WITH CHECK (policy.manage AND
-- accepted_by = auth.uid()) — mirrors the 0043 governance-insert precedent. Read = policy.manage. No
-- new permission (catalog stays 23). No new SECURITY DEFINER function (reuses prevent_mutation +
-- log_audit). Revocation is OUT of scope (a waiver ends via expires_at; explicit revocation is a later
-- slice). DELIBERATELY ABSENT: UI (1-C).
--
-- Also adds a composite UNIQUE (id, organization_id, policy_version_id) to policy_health_evaluations
-- (0046, which had only a PK on id) so the health_evaluation_id FK below can be same-tenant (SI-7) AND
-- pin the evaluation's own version — the acceptance references (health_evaluation_id, organization_id,
-- policy_version_id), which forces the waiver's policy_version_id to EQUAL the referenced evaluation's
-- version at the DB layer (a waiver can never mis-attribute a driver to a different version). Net-new
-- (verified absent); id is already the PK so the constraint is trivially satisfiable. Mirrors how 0009
-- added a composite unique to scoring_policy_versions to enable same-org FKs.
-- =============================================================================

alter table public.policy_health_evaluations
  add constraint policy_health_evaluations_id_org_version_uq unique (id, organization_id, policy_version_id);

create table public.policy_health_risk_acceptances (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  policy_version_id    uuid not null,                 -- the version whose risk is waived (READ-ONLY; §26/AD7)
  health_evaluation_id uuid not null,                 -- the evaluation the waived driver belongs to
  dimension            text not null,                 -- e.g. 'payout_concentration' (which sub-score)
  driver_code          text not null,                 -- e.g. 'GINI_HIGH' (which risk driver is waived)
  reason               text not null,                 -- MANDATORY justification (§3.8)
  accepted_by          uuid not null,                 -- actor (memberships.profile_id); = auth.uid()
  accepted_at          timestamptz not null default now(),  -- server-stamped
  expires_at           timestamptz,                   -- optional; the waiver lapses after this instant
  created_at           timestamptz not null default now(),
  constraint policy_health_risk_acceptances_reason_chk check (length(btrim(reason)) > 0),
  constraint policy_health_risk_acceptances_dimension_chk check (length(btrim(dimension)) > 0),
  constraint policy_health_risk_acceptances_driver_chk check (length(btrim(driver_code)) > 0),
  -- Expiry sanity: a waiver cannot expire before (or at) the moment it is accepted.
  constraint policy_health_risk_acceptances_expiry_chk
    check (expires_at is null or expires_at > accepted_at),
  -- Same-org composite FKs (SI-7): the waived version, its evaluation, and the actor are same-tenant.
  constraint policy_health_risk_acceptances_version_org_fk
    foreign key (policy_version_id, organization_id)
    references public.scoring_policy_versions (id, organization_id),
  -- The evaluation FK is 3-column: it pins organization_id AND policy_version_id, so the waiver's
  -- policy_version_id MUST equal the referenced evaluation's own version — the DB enforces the
  -- waiver→evaluation→version linkage (no app-only trust; a driver can't be mis-attributed to another
  -- version). Targets the (id, organization_id, policy_version_id) unique added to 0046 above.
  constraint policy_health_risk_acceptances_evaluation_org_fk
    foreign key (health_evaluation_id, organization_id, policy_version_id)
    references public.policy_health_evaluations (id, organization_id, policy_version_id),
  constraint policy_health_risk_acceptances_accepted_by_org_fk
    foreign key (organization_id, accepted_by)
    references public.memberships (organization_id, profile_id)
);

comment on table public.policy_health_risk_acceptances is
  'Incentive Health risk acceptances (Module 1-B, §3.8/§2.7). Append-only, AUDITED waivers: a policy '
  'owner explicitly ACCEPTS a specific health risk driver (dimension + driver_code) of a '
  'policy_health_evaluations row, with a mandatory reason + actor (accepted_by = auth.uid()) + server '
  'accepted_at (+ optional expires_at). A risk is never silently dismissed (§3.8). Accepting NEVER '
  'changes the computed health score and mutates no policy/ledger (§26/AD7). Authenticated INSERT gated '
  'by policy.manage + accepted_by = auth.uid(); read policy.manage; UPDATE/DELETE blocked '
  '(prevent_mutation); audited on INSERT (policy risk waiver). Sensitivity: confidential, audit-critical.';
comment on column public.policy_health_risk_acceptances.driver_code is
  'The transparent risk driver code being waived (from the evaluation dimensions[].items[].drivers[].code, '
  'e.g. GINI_HIGH / THRESHOLD_CLIFF). The (dimension, driver_code) is validated against the referenced '
  'evaluation by the application; the version↔evaluation linkage is DB-enforced (3-column FK above).';

create index idx_policy_health_risk_acceptances_org_version
  on public.policy_health_risk_acceptances (organization_id, policy_version_id);

-- Append-only: block UPDATE and DELETE (a waiver is an immutable governance fact; it lapses via
-- expires_at, it is never edited or removed).
create trigger trg_policy_health_risk_acceptances_immutable
  before update or delete on public.policy_health_risk_acceptances
  for each row execute function public.prevent_mutation();

-- Audit on creation (append-only ⇒ only INSERT fires) — §2.7 "policy risk waiver".
create trigger trg_audit_policy_health_risk_acceptances
  after insert on public.policy_health_risk_acceptances
  for each row execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies.
--   read   : policy.manage holders (org-scoped).
--   insert : policy.manage holders record their OWN waiver (accepted_by = self). No UPDATE/DELETE
--            privilege; append-only immutability also enforced by the trigger (even vs bypassrls).
-- =============================================================================
alter table public.policy_health_risk_acceptances enable row level security;
alter table public.policy_health_risk_acceptances force row level security;
revoke all on public.policy_health_risk_acceptances from anon, authenticated;
grant select, insert on public.policy_health_risk_acceptances to authenticated;  -- NO update / delete
grant all on public.policy_health_risk_acceptances to service_role;

create policy policy_health_risk_acceptances_select on public.policy_health_risk_acceptances
  for select to authenticated
  using (organization_id = public.current_org() and public.has_permission('policy.manage'));

create policy policy_health_risk_acceptances_insert on public.policy_health_risk_acceptances
  for insert to authenticated
  with check (
    organization_id = public.current_org()
    and public.has_permission('policy.manage')
    and accepted_by = auth.uid()
  );
-- No UPDATE/DELETE policy or privilege → append-only; prevent_mutation trigger is defense-in-depth.
