-- =============================================================================
-- pgTAP — Onboarding-A blocking suite: create_organization (org bootstrap)
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 0033 create_organization, 0002/0003 (org/profile/membership), 0005 (audit),
--       Decision Lock ("bir kullanıcı birden çok org'da farklı role sahip olabilir").
--
-- Decision (a): MULTI-ORG allowed, NO double-join guard. #3 proves the same user can
-- own a SECOND org (two owner memberships) — the function does not block re-join.
--
-- Same conventions as 0024/0025: whole file in a rolled-back transaction; seed assumed
-- present. Callers need a real auth.users row (profiles.id FKs auth.users) — U1 is a
-- fresh auth.users row inserted here (mirrors seed_test_tenants.sql), with NO existing
-- profile/membership. request.jwt.claims stamps auth.uid(); throws_ok uses the errcode
-- form with NULL message (house style — cf. 0024/0025).
-- =============================================================================
begin;
select plan(4);

-- Fresh caller U1: a real auth.users row (satisfies profiles.id FK) with no profile
-- or membership yet. Mirrors the seed's minimal auth.users insert shape.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '0b0b0b0b-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated',
  'onboarding-u1@meritflow.test', extensions.crypt('password123', extensions.gen_salt('bf')),
  now(), now(), now(), '', '', '', ''
);

-- Caller = U1.
select set_config('request.jwt.claims', '{"sub":"0b0b0b0b-0000-0000-0000-0000000000c1","role":"authenticated"}', true);

-- Happy path (call in its own statement, then assert on the created rows).
select public.create_organization('Acme Yeni', 'acme-yeni', 'Ada') as org1_id \gset

-- (#0) happy: org row + owner membership + profile + audit row all created for U1.
select ok(
  exists (
    select 1 from public.organizations o
    where o.slug = 'acme-yeni' and o.name = 'Acme Yeni'
  )
  and exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where o.slug = 'acme-yeni'
      and m.profile_id = '0b0b0b0b-0000-0000-0000-0000000000c1'
      and m.primary_role = 'owner'
      and m.status = 'active'
  )
  and exists (
    select 1 from public.profiles p
    where p.id = '0b0b0b0b-0000-0000-0000-0000000000c1' and p.display_name = 'Ada'
  )
  and exists (
    select 1 from public.audit_logs al
    join public.organizations o on o.id = al.organization_id
    where o.slug = 'acme-yeni' and al.action = 'org.created'
      and al.target_type = 'organizations'
      and al.actor_id = '0b0b0b0b-0000-0000-0000-0000000000c1'
  ),
  'happy: create_organization creates org + owner membership + profile + org.created audit row'
);

-- (#1) duplicate slug: 'acme' already exists in the seed -> unique_violation (23505).
select throws_ok(
  $$ select public.create_organization('Dup', 'acme', 'X') $$,
  '23505', NULL, 'duplicate slug -> 23505 (organizations_slug_key)'
);

-- (#2) anon: no auth.uid() -> unauthenticated (42501). Execute is also revoked from
--      anon, so the role switch alone would deny; the body's guard is the assertion.
set local role anon;
select throws_ok(
  $$ select public.create_organization('X', 'x-org', 'Y') $$,
  '42501', NULL, 'anon (no auth.uid()) -> 42501 unauthenticated'
);
reset role;

-- (#3) multi-org (decision a): U1 creates a SECOND org with a different slug -> succeeds;
--      U1 now holds TWO owner memberships (proves NO double-join guard).
select public.create_organization('Acme Iki', 'acme-iki', 'Ada') as org2_id \gset
select is(
  (select count(*) from public.memberships
     where profile_id = '0b0b0b0b-0000-0000-0000-0000000000c1'
       and primary_role = 'owner' and status = 'active'),
  2::bigint,
  'multi-org (decision a): same user owns two orgs — no double-join guard'
);

select * from finish();
rollback;
