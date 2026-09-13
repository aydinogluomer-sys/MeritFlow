-- =============================================================================
-- pgTAP — Phase P2 / slice 1-B: policy_health_risk_acceptances (health risk-acceptance / waiver store).
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: migration 0047; §3.8 (Accept Risk: reason + actor + timestamp + optional expiry), §2.7 (audit:
--   policy risk waiver), §26 (Health gate). Proves: RLS ENABLE+FORCE + least-priv grants (select+insert,
--   NO update/delete); read gated by policy.manage; cross-tenant isolation (org A vs org B) — BLOCKING;
--   AUTHENTICATED INSERT gated by policy.manage AND accepted_by = auth.uid() (else 42501); reason
--   non-empty (CHECK); expiry sanity (CHECK); append-only IMMUTABILITY (UPDATE/DELETE blocked); INSERT
--   audited (§2.7); same-org composite FKs reject cross-org; permission catalog unchanged (23).
-- Fixtures (seed): a0..fa (Org A, eval a0..eb, owner a1) + b0..fa (Org B, eval b0..eb, owner b1).
--   Actors: a1 owner + a3 hr (policy.manage) read/insert; a4 finance / a7 employee / a9 auditor cannot.
-- =============================================================================
begin;
select no_plan();

-- ---- table + RLS shape -------------------------------------------------------
select has_table('public', 'policy_health_risk_acceptances', 'policy_health_risk_acceptances table exists');
select ok(
  (select relrowsecurity from pg_class where relname = 'policy_health_risk_acceptances' and relnamespace = 'public'::regnamespace),
  'RLS ENABLED on policy_health_risk_acceptances');
select ok(
  (select relforcerowsecurity from pg_class where relname = 'policy_health_risk_acceptances' and relnamespace = 'public'::regnamespace),
  'RLS FORCED on policy_health_risk_acceptances');

-- ---- least-privilege grants (authenticated may read + insert; NEVER update/delete — append-only) ----
select ok(has_table_privilege('authenticated', 'public.policy_health_risk_acceptances', 'SELECT'),
  'authenticated may SELECT');
select ok(has_table_privilege('authenticated', 'public.policy_health_risk_acceptances', 'INSERT'),
  'authenticated may INSERT (user records own waiver)');
select ok(not has_table_privilege('authenticated', 'public.policy_health_risk_acceptances', 'UPDATE'),
  'authenticated may NOT UPDATE (append-only)');
select ok(not has_table_privilege('authenticated', 'public.policy_health_risk_acceptances', 'DELETE'),
  'authenticated may NOT DELETE (append-only)');

-- ---- permission catalog unchanged (23; 1-B reuses policy.manage, adds no permission) --------------
select is((select count(*) from public.permissions), 23::bigint,
  'permission catalog unchanged at 23 (1-B reuses policy.manage)');

-- =============================================================================
-- RLS reads (switch to authenticated). Read is gated by policy.manage (owner/admin/hr).
-- =============================================================================
set local role authenticated;

-- Owner a1 (policy.manage) sees the Org A waiver; NONE of Org B (cross-tenant isolation).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
select ok((select count(*) from public.policy_health_risk_acceptances) >= 1,
  'RLS: owner (policy.manage) sees Org A waiver(s)');
select is((select count(*) from public.policy_health_risk_acceptances
           where organization_id = 'b0000000-0000-0000-0000-000000000002'::uuid), 0::bigint,
  'RLS: owner cannot see Org B waivers (cross-tenant isolation)');

-- HR a3 (policy.manage) also sees Org A.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a3"}', true);
select ok((select count(*) from public.policy_health_risk_acceptances) >= 1,
  'RLS: HR (policy.manage) sees Org A waiver(s)');

-- Finance a4, employee a7, auditor a9 (NO policy.manage) see NONE.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select is((select count(*) from public.policy_health_risk_acceptances), 0::bigint,
  'RLS: finance (no policy.manage) sees nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7"}', true);
select is((select count(*) from public.policy_health_risk_acceptances), 0::bigint,
  'RLS: employee (no policy.manage) sees nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*) from public.policy_health_risk_acceptances), 0::bigint,
  'RLS: auditor (no policy.manage) sees nothing');

-- Org B owner b1 sees only the Org B waiver (isolation, other direction).
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-0000000000b1"}', true);
select is((select count(*) from public.policy_health_risk_acceptances
           where organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid), 0::bigint,
  'RLS: Org B owner cannot see Org A waivers (cross-tenant isolation)');

-- =============================================================================
-- AUTHENTICATED INSERT gating (RLS WITH CHECK: policy.manage AND accepted_by = auth.uid()).
-- =============================================================================
-- Owner a1 records their OWN waiver over an Org A evaluation -> allowed.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
select lives_ok($$
  insert into public.policy_health_risk_acceptances
    (organization_id, policy_version_id, health_evaluation_id, dimension, driver_code, reason, accepted_by)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2',
          'a0000000-0000-0000-0000-0000000000eb', 'complexity', 'COMPLEXITY_DEBT',
          'Karmaşıklık kabul edildi.', 'a0000000-0000-0000-0000-0000000000a1') $$,
  'RLS: owner (policy.manage) can record their own waiver');

-- Owner a1 stamping SOMEONE ELSE as accepted_by (a3) -> 42501 (WITH CHECK accepted_by = auth.uid()).
select throws_ok($$
  insert into public.policy_health_risk_acceptances
    (organization_id, policy_version_id, health_evaluation_id, dimension, driver_code, reason, accepted_by)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2',
          'a0000000-0000-0000-0000-0000000000eb', 'complexity', 'COMPLEXITY_DEBT',
          'spoofed actor', 'a0000000-0000-0000-0000-0000000000a3') $$,
  '42501', NULL, 'RLS: cannot record a waiver on behalf of another actor (accepted_by = auth.uid())');

-- Finance a4 (no policy.manage) cannot record a waiver even for self -> 42501.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a4"}', true);
select throws_ok($$
  insert into public.policy_health_risk_acceptances
    (organization_id, policy_version_id, health_evaluation_id, dimension, driver_code, reason, accepted_by)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2',
          'a0000000-0000-0000-0000-0000000000eb', 'complexity', 'COMPLEXITY_DEBT',
          'no perm', 'a0000000-0000-0000-0000-0000000000a4') $$,
  '42501', NULL, 'RLS: without policy.manage cannot record a waiver');

-- Owner a1 with a BLANK reason -> 23514 (reason non-empty CHECK), passing RLS but failing the constraint.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1"}', true);
select throws_ok($$
  insert into public.policy_health_risk_acceptances
    (organization_id, policy_version_id, health_evaluation_id, dimension, driver_code, reason, accepted_by)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2',
          'a0000000-0000-0000-0000-0000000000eb', 'complexity', 'COMPLEXITY_DEBT',
          '   ', 'a0000000-0000-0000-0000-0000000000a1') $$,
  '23514', NULL, 'reason must be non-empty (a risk is never dismissed without a reason — §3.8)');

reset role;

-- =============================================================================
-- Immutability + audit + expiry + same-org FKs (bypassrls; triggers/constraints apply universally).
-- =============================================================================
-- UPDATE blocked (prevent_mutation — a waiver is an immutable governance fact).
select throws_ok($$
  update public.policy_health_risk_acceptances set reason = 'edited'
  where id = 'a0000000-0000-0000-0000-0000000000fa' $$,
  NULL, 'policy_health_risk_acceptances UPDATE is blocked (append-only)');

-- DELETE blocked (prevent_mutation).
select throws_ok($$
  delete from public.policy_health_risk_acceptances where id = 'a0000000-0000-0000-0000-0000000000fa' $$,
  NULL, 'policy_health_risk_acceptances DELETE is blocked (append-only)');

-- INSERT is audited (the seed insert produced an audit_logs row) — §2.7 policy risk waiver.
select ok(
  exists (select 1 from public.audit_logs al
          where al.target_id = 'a0000000-0000-0000-0000-0000000000fa'
            and al.action = 'policy_health_risk_acceptances.insert'),
  'the waiver INSERT is written to audit_logs (policy_health_risk_acceptances.insert)');

-- Expiry sanity: expires_at must be strictly after accepted_at -> 23514.
select throws_ok($$
  insert into public.policy_health_risk_acceptances
    (organization_id, policy_version_id, health_evaluation_id, dimension, driver_code, reason, accepted_by, expires_at)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2',
          'a0000000-0000-0000-0000-0000000000eb', 'complexity', 'COMPLEXITY_DEBT',
          'past expiry', 'a0000000-0000-0000-0000-0000000000a1', now() - interval '1 day') $$,
  '23514', NULL, 'expires_at must be after accepted_at (expiry sanity CHECK)');

-- Same-org composite FK: an Org A waiver cannot reference an Org B evaluation -> 23503.
select throws_ok($$
  insert into public.policy_health_risk_acceptances
    (organization_id, policy_version_id, health_evaluation_id, dimension, driver_code, reason, accepted_by)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2',
          'b0000000-0000-0000-0000-0000000000eb', 'complexity', 'COMPLEXITY_DEBT',
          'cross-org eval', 'a0000000-0000-0000-0000-0000000000a1') $$,
  '23503', NULL, 'same-org FK: Org A waiver cannot reference an Org B health evaluation');

-- Version↔evaluation linkage (3-column FK): policy_version_id must equal the referenced evaluation's
-- own version. Eval a0..eb belongs to version a0..d2; pairing it with a DIFFERENT same-org version
-- (a0..d1) mis-attributes the driver -> 23503 (DB-enforced, not left to the application).
select throws_ok($$
  insert into public.policy_health_risk_acceptances
    (organization_id, policy_version_id, health_evaluation_id, dimension, driver_code, reason, accepted_by)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d1',
          'a0000000-0000-0000-0000-0000000000eb', 'complexity', 'COMPLEXITY_DEBT',
          'version mismatch', 'a0000000-0000-0000-0000-0000000000a1') $$,
  '23503', NULL, 'linkage FK: waiver policy_version_id must equal the referenced evaluation''s version');

-- Same-org composite FK: accepted_by must be a member of the org -> 23503 (Org B owner in Org A row).
select throws_ok($$
  insert into public.policy_health_risk_acceptances
    (organization_id, policy_version_id, health_evaluation_id, dimension, driver_code, reason, accepted_by)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000d2',
          'a0000000-0000-0000-0000-0000000000eb', 'complexity', 'COMPLEXITY_DEBT',
          'non-member actor', 'b0000000-0000-0000-0000-0000000000b1') $$,
  '23503', NULL, 'same-org FK: accepted_by must be a member of the organization');

select * from finish();
rollback;
