-- =============================================================================
-- pgTAP — Phase P0: intelligence_insights + feature_flags (shared intelligence foundation).
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: migration 0042; plan §2.4/§2.5/§2.6. Proves: RLS ENABLE+FORCE, least-privilege grants,
--       cross-tenant isolation (org A cannot see org B), server-only insight writes, employee-own
--       read via RLS (no catalog permission), manage-gated feature-flag writes, permission catalog
--       22, and the DB-level evidence + action invariants.
-- Actors (seeded): Org A a1 owner(read+manage), a3 hr(read), a7 employee(neither), a9 auditor(read);
--                  Org B b1 owner(read+manage).
-- =============================================================================
begin;
select no_plan();

-- ---- table + RLS shape -------------------------------------------------------
select has_table('public', 'intelligence_insights', 'intelligence_insights table exists');
select has_table('public', 'feature_flags', 'feature_flags table exists');
select ok(
  (select relrowsecurity from pg_class where relname = 'intelligence_insights' and relnamespace = 'public'::regnamespace),
  'RLS ENABLED on intelligence_insights');
select ok(
  (select relforcerowsecurity from pg_class where relname = 'intelligence_insights' and relnamespace = 'public'::regnamespace),
  'RLS FORCED on intelligence_insights');
select ok(
  (select relrowsecurity from pg_class where relname = 'feature_flags' and relnamespace = 'public'::regnamespace),
  'RLS ENABLED on feature_flags');
select ok(
  (select relforcerowsecurity from pg_class where relname = 'feature_flags' and relnamespace = 'public'::regnamespace),
  'RLS FORCED on feature_flags');

-- ---- least-privilege grants --------------------------------------------------
select ok(has_table_privilege('authenticated', 'public.intelligence_insights', 'SELECT'),
  'authenticated may SELECT intelligence_insights');
select ok(not has_table_privilege('authenticated', 'public.intelligence_insights', 'INSERT'),
  'authenticated may NOT INSERT intelligence_insights (server-only writes)');
select ok(not has_table_privilege('authenticated', 'public.intelligence_insights', 'UPDATE'),
  'authenticated may NOT UPDATE intelligence_insights (server-only writes)');
select ok(not has_table_privilege('authenticated', 'public.intelligence_insights', 'DELETE'),
  'authenticated may NOT DELETE intelligence_insights');
select ok(has_table_privilege('authenticated', 'public.feature_flags', 'SELECT'),
  'authenticated may SELECT feature_flags');
select ok(has_table_privilege('authenticated', 'public.feature_flags', 'INSERT'),
  'authenticated may INSERT feature_flags (RLS gates by intelligence.manage)');
select ok(has_table_privilege('authenticated', 'public.feature_flags', 'UPDATE'),
  'authenticated may UPDATE feature_flags (RLS gates by intelligence.manage)');
select ok(not has_table_privilege('authenticated', 'public.feature_flags', 'DELETE'),
  'authenticated may NOT DELETE feature_flags');

-- ---- permission catalog (20 -> 22) ------------------------------------------
select is((select count(*) from public.permissions), 22::bigint,
  'permission catalog is 22 (intelligence.read + intelligence.manage added)');
select is((select count(*) from public.permissions where key in ('intelligence.read', 'intelligence.manage')),
  2::bigint, 'both intelligence permissions exist');
select is((select count(*) from public.role_permissions
           where permission_key = 'intelligence.manage' and role_key = 'owner'), 1::bigint,
  'owner holds intelligence.manage');
select is((select count(*) from public.role_permissions
           where permission_key in ('intelligence.read', 'intelligence.manage') and role_key = 'employee'),
  0::bigint, 'employee holds NEITHER intelligence permission (own data via RLS only)');

-- ---- feature flags seeded (9 per org) ---------------------------------------
select is((select count(*) from public.feature_flags
           where organization_id = 'a0000000-0000-0000-0000-000000000001'), 9::bigint,
  'Org A seeded with the 9 module feature flags');
select is((select count(*) from public.feature_flags
           where organization_id = 'a0000000-0000-0000-0000-000000000001' and enabled), 0::bigint,
  'all Org A flags default OFF');

-- ---- insight fixtures (inserted as the bypassrls migration role) -------------
-- iA1: Org A team insight (bonus_period_id set -> exercises the same-org composite FK).
-- iA2: Org A employee insight for emp-alpha a7 (exercises the employee-own RLS branch).
-- iB1: Org B team insight (cross-tenant negative).
insert into public.intelligence_insights
  (id, organization_id, insight_type, subject_type, subject_id, bonus_period_id, severity, status,
   deterministic_payload, evidence_refs)
values
  ('a0000000-0000-0000-0000-0000000000ac', 'a0000000-0000-0000-0000-000000000001',
   'payout_concentration', 'team', 'a0000000-0000-0000-0000-0000000000f1',
   'a0000000-0000-0000-0000-0000000000fa', 'warning', 'calculated',
   '{"headline":"Yogunlasma","facts":{"top1":0.32},"suggestedActions":[{"code":"inspect","label":"Incele"}]}'::jsonb,
   '[{"sourceType":"metric","sourceId":"payout_concentration"}]'::jsonb),
  ('a0000000-0000-0000-0000-0000000000ad', 'a0000000-0000-0000-0000-000000000001',
   'opportunity_gap', 'employee', 'a0000000-0000-0000-0000-0000000000a7',
   null, 'info', 'calculated',
   '{"headline":"Firsat","facts":{"idx":0.7},"suggestedActions":[{"code":"inspect","label":"Incele"}]}'::jsonb,
   '[{"sourceType":"metric","sourceId":"opportunity_index"}]'::jsonb),
  ('b0000000-0000-0000-0000-0000000000ac', 'b0000000-0000-0000-0000-000000000002',
   'payout_concentration', 'team', null,
   null, 'warning', 'calculated',
   '{"headline":"B","facts":{"top1":0.5},"suggestedActions":[{"code":"inspect","label":"Incele"}]}'::jsonb,
   '[{"sourceType":"metric","sourceId":"payout_concentration"}]'::jsonb);

-- ---- DB-level evidence + action invariants (reject bad payloads) -------------
select throws_ok($$
  insert into public.intelligence_insights
    (organization_id, insight_type, subject_type, severity, status, deterministic_payload, evidence_refs)
  values ('a0000000-0000-0000-0000-000000000001', 't', 'team', 'info', 'draft',
          '{"headline":"h","facts":{},"suggestedActions":[{"code":"x","label":"y"}]}'::jsonb,
          '[]'::jsonb) $$,
  '23514', NULL, 'insight with EMPTY evidence_refs is rejected (evidence invariant)');
select throws_ok($$
  insert into public.intelligence_insights
    (organization_id, insight_type, subject_type, severity, status, deterministic_payload, evidence_refs)
  values ('a0000000-0000-0000-0000-000000000001', 't', 'team', 'info', 'draft',
          '{"headline":"h","facts":{},"suggestedActions":[]}'::jsonb,
          '[{"sourceType":"metric","sourceId":"m1"}]'::jsonb) $$,
  '23514', NULL, 'insight with NO suggestedActions is rejected (action invariant)');

-- ---- RLS reads (switch to authenticated) ------------------------------------
set local role authenticated;

-- HR a3 (has intelligence.read) sees BOTH Org A insights, NONE of Org B (tenant isolation).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select is((select count(*) from public.intelligence_insights), 2::bigint,
  'RLS: HR (intelligence.read) sees the 2 Org A insights only');
select is((select count(*) from public.intelligence_insights
           where organization_id = 'b0000000-0000-0000-0000-000000000002'), 0::bigint,
  'RLS: HR cannot see Org B insights (cross-tenant isolation)');
select is((select count(*) from public.feature_flags), 9::bigint,
  'RLS: org member reads only their org feature flags (org-scoped, 9)');

-- Employee a7 (NO intelligence.read) sees ONLY their own employee insight (iA2), not the team one.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.intelligence_insights), 1::bigint,
  'RLS: employee sees only their OWN explainable insight (employee-own branch)');
select is((select id from public.intelligence_insights),
  'a0000000-0000-0000-0000-0000000000ad'::uuid,
  'RLS: the single visible insight is the employee-own one (iA2)');

-- Employee a7 (no manage) CANNOT write a feature flag (manage-gated).
select throws_ok($$
  insert into public.feature_flags (organization_id, flag_key, stage, enabled)
  values ('a0000000-0000-0000-0000-000000000001', 'new_flag', 'off', false) $$,
  '42501', NULL, 'RLS: non-manage employee cannot INSERT a feature flag');

-- Owner a1 (has manage) CAN toggle a feature flag.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
select lives_ok($$
  update public.feature_flags set enabled = true
  where organization_id = 'a0000000-0000-0000-0000-000000000001' and flag_key = 'intelligence' $$,
  'RLS: owner (intelligence.manage) can toggle a feature flag');
select is((select enabled from public.feature_flags
           where organization_id = 'a0000000-0000-0000-0000-000000000001' and flag_key = 'intelligence'),
  true, 'the flag toggle persisted');

-- Owner a1 (even with manage) CANNOT INSERT an insight — writes are server-only (no grant/policy).
select throws_ok($$
  insert into public.intelligence_insights
    (organization_id, insight_type, subject_type, severity, status, deterministic_payload, evidence_refs)
  values ('a0000000-0000-0000-0000-000000000001', 't', 'team', 'info', 'draft',
          '{"headline":"h","facts":{},"suggestedActions":[{"code":"x","label":"y"}]}'::jsonb,
          '[{"sourceType":"metric","sourceId":"m1"}]'::jsonb) $$,
  '42501', NULL, 'RLS/grant: authenticated (owner) cannot INSERT an insight (server-only writes)');

-- Org B owner b1 sees only Org B's insight (cross-tenant isolation, other direction).
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-0000000000b1"}', true);
select is((select count(*) from public.intelligence_insights), 1::bigint,
  'RLS: Org B owner sees only the Org B insight');

reset role;

select * from finish();
rollback;
