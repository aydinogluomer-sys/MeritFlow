-- =============================================================================
-- Migration 0042 — Product Intelligence shared foundation (Phase P0). Refs: implementation plan
-- §2 (Shared Foundation): §2.4 insight store, §2.5 feature flags, §2.6 permission catalog, §2.8
-- lifecycle; §21 rollout lifecycle. CLAUDE.md (RLS on every table; DB-sourced authz, AD1). Local
-- dev/staging only — never production (ADR-014).
--
-- Two NET-NEW tenant tables + two NET-NEW permissions. NO LLM, NO financial calculation, NO ledger
-- mutation here — this is pure plumbing every later intelligence module depends on. The insight
-- store's deterministic_payload + evidence_refs are AUTHORITATIVE facts; model_payload is advisory
-- and nullable (stays null in P0). Both tables are org-scoped with RLS ENABLE+FORCE in THIS slice.
-- =============================================================================

-- =============================================================================
-- 1) Permission catalog additions (plan §2.6). Only the two intelligence permissions land in P0;
--    the other 5 module permissions ship with their modules. Mirrors 0035_base_data (production-safe
--    reference data; idempotent). Raises the global permission catalog 20 -> 22.
-- =============================================================================
insert into public.permissions (key, label, domain, is_sensitive) values
  ('intelligence.read',   'Read intelligence insights',   'intelligence', false),
  ('intelligence.manage', 'Manage intelligence insights', 'intelligence', false)
on conflict (key) do nothing;

-- Role wiring: owner/admin manage (+read); hr/finance/manager/auditor read. Employee gets NEITHER —
-- employees reach only their OWN explainable insights via RLS (subject_type='employee' + auth.uid()),
-- never via a catalog permission (plan §2.6).
insert into public.role_permissions (role_key, permission_key)
select r, p from (values
  ('owner',   'intelligence.read'), ('owner',   'intelligence.manage'),
  ('admin',   'intelligence.read'), ('admin',   'intelligence.manage'),
  ('hr',      'intelligence.read'),
  ('finance', 'intelligence.read'),
  ('manager', 'intelligence.read'),
  ('auditor', 'intelligence.read')
) as rp(r, p)
on conflict (role_key, permission_key) do nothing;

-- =============================================================================
-- 2) intelligence_insights — shared insight store (plan §2.4, exact column set). Status follows the
--    §2.8 lifecycle (draft -> calculated -> reviewed -> accepted|dismissed -> applied -> observed ->
--    retrospective). Writes are SERVER-ONLY (service_role); the status machine is enforced in TS
--    (src/modules/intelligence/domain/insight-status.ts) since there is no client write path. NO
--    audit trigger — opening an analytics record is not one of the audited business mutations (§2.7).
-- =============================================================================
create table public.intelligence_insights (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  insight_type          text not null,
  subject_type          text not null,          -- polymorphic subject class (employee/team/policy_version/...)
  subject_id            uuid,                    -- polymorphic id (no FK — like disputes.target_id)
  bonus_period_id       uuid,                    -- optional period context (same-org composite FK below)
  severity              text not null,
  status                text not null default 'draft',
  deterministic_payload jsonb not null,          -- AUTHORITATIVE: { headline, facts, suggestedActions }
  model_payload         jsonb,                   -- ADVISORY (LLM narrative); nullable; null in P0
  evidence_refs         jsonb not null,          -- AUTHORITATIVE: EvidenceRef[]
  first_detected_at     timestamptz not null default now(),
  last_detected_at      timestamptz not null default now(),
  resolved_at           timestamptz,
  resolution_code       text,
  created_at            timestamptz not null default now(),
  constraint intelligence_insights_severity_chk
    check (severity in ('info', 'warning', 'critical')),
  constraint intelligence_insights_status_chk
    check (status in ('draft', 'calculated', 'reviewed', 'accepted', 'dismissed',
                      'applied', 'observed', 'retrospective')),
  constraint intelligence_insights_insight_type_chk check (length(btrim(insight_type)) > 0),
  constraint intelligence_insights_subject_type_chk check (length(btrim(subject_type)) > 0),
  constraint intelligence_insights_resolution_code_chk
    check (resolution_code is null or length(btrim(resolution_code)) > 0),
  constraint intelligence_insights_detected_order_chk
    check (last_detected_at >= first_detected_at),
  -- Evidence invariant (§1 pt.5 / anti-pattern §23): every insight carries >= 1 evidence ref.
  constraint intelligence_insights_evidence_refs_chk
    check (jsonb_typeof(evidence_refs) = 'array' and jsonb_array_length(evidence_refs) >= 1),
  -- Action invariant (§1 pt.6 / anti-pattern §23): deterministic_payload is an object carrying
  -- >= 1 suggested action (there is no separate actions column in §2.4 — actions live in the payload).
  constraint intelligence_insights_deterministic_payload_chk
    check (jsonb_typeof(deterministic_payload) = 'object'
       and jsonb_typeof(deterministic_payload -> 'suggestedActions') = 'array'
       and jsonb_array_length(deterministic_payload -> 'suggestedActions') >= 1),
  -- Same-org composite FK: an insight's period must belong to the SAME tenant (SI-7). Only enforced
  -- when bonus_period_id is present (MATCH SIMPLE: a null column skips the check).
  constraint intelligence_insights_period_org_fk
    foreign key (bonus_period_id, organization_id)
    references public.bonus_periods (id, organization_id)
);

comment on table public.intelligence_insights is
  'Shared insight store (Phase P0, plan §2.4). deterministic_payload (headline/facts/suggestedActions) '
  '+ evidence_refs are AUTHORITATIVE, reproducible facts; model_payload is advisory/nullable (LLM '
  'narrative, null in P0). Status lifecycle §2.8. RLS: intelligence.read OR employee-own; server-only writes.';
comment on column public.intelligence_insights.deterministic_payload is
  'Authoritative deterministic content { headline, facts, suggestedActions }. LLM narrates FROM these only.';
comment on column public.intelligence_insights.model_payload is
  'Advisory LLM narrative; nullable; never authoritative; null in P0 (no LLM).';
comment on column public.intelligence_insights.evidence_refs is
  'EvidenceRef[] (>=1 enforced) — every insight is traceable to deterministic evidence (§1 pt.5).';

create index idx_intelligence_insights_org_status
  on public.intelligence_insights (organization_id, status);
create index idx_intelligence_insights_org_type
  on public.intelligence_insights (organization_id, insight_type);
-- Employee-own lookups (RLS branch + "my explainable data" surface).
create index idx_intelligence_insights_org_subject
  on public.intelligence_insights (organization_id, subject_type, subject_id);

-- RLS: ENABLE + FORCE + least privilege. Read = intelligence.read holders OR the subject employee
-- themselves (own explainable data, §2.6). Writes are server-only (no INSERT/UPDATE/DELETE policy).
alter table public.intelligence_insights enable row level security;
alter table public.intelligence_insights force row level security;
revoke all on public.intelligence_insights from anon, authenticated;
grant select on public.intelligence_insights to authenticated;
grant all on public.intelligence_insights to service_role;

create policy intelligence_insights_select on public.intelligence_insights
  for select to authenticated
  using (
    organization_id = public.current_org()
    and (
      public.has_permission('intelligence.read')
      or (subject_type = 'employee' and subject_id = auth.uid())
    )
  );
-- No INSERT/UPDATE/DELETE policy → server-only writes (service_role / SECURITY DEFINER RPCs later).

-- =============================================================================
-- 3) feature_flags — per-tenant rollout switch (plan §2.5, §21 lifecycle off -> internal ->
--    design_partner -> beta -> general). Org-scoped read for any member (the app resolves flags per
--    request); writes gated by intelligence.manage. Flags default OFF; a missing row resolves false.
-- =============================================================================
create table public.feature_flags (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  flag_key        text not null,
  stage           text not null default 'off',
  enabled         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint feature_flags_stage_chk
    check (stage in ('off', 'internal', 'design_partner', 'beta', 'general')),
  constraint feature_flags_key_chk check (length(btrim(flag_key)) > 0),
  constraint feature_flags_org_key_uq unique (organization_id, flag_key)
);

comment on table public.feature_flags is
  'Per-tenant feature rollout flags (Phase P0, plan §2.5 / §21). Default off; a missing row resolves '
  'false. Org-scoped read; writes gated by intelligence.manage. Not audited (internal rollout config).';

create index idx_feature_flags_org on public.feature_flags (organization_id);

create trigger trg_feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

alter table public.feature_flags enable row level security;
alter table public.feature_flags force row level security;
revoke all on public.feature_flags from anon, authenticated;
grant select, insert, update on public.feature_flags to authenticated;
grant all on public.feature_flags to service_role;

create policy feature_flags_select on public.feature_flags
  for select to authenticated
  using (organization_id = public.current_org());

create policy feature_flags_insert on public.feature_flags
  for insert to authenticated
  with check (organization_id = public.current_org() and public.has_permission('intelligence.manage'));

create policy feature_flags_update on public.feature_flags
  for update to authenticated
  using (organization_id = public.current_org() and public.has_permission('intelligence.manage'))
  with check (organization_id = public.current_org() and public.has_permission('intelligence.manage'));
-- No DELETE policy/grant → flags are toggled (enabled/stage), never deleted from the client.
