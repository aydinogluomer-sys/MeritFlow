-- =============================================================================
-- pgTAP — Onboarding-B blocking suite: create_invitation + accept_invitation
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: 0034 create_invitation/accept_invitation, 0002/0003 (org/profile/membership),
--       0005 (audit), 0006 (current_org/has_permission), Decision Lock AD1/AD2.
--
-- Inviter = seed Org A owner (a0000000-…-a1): holds user.invite and has a SINGLE
-- active membership, so current_org() resolves to Org A (a0000000-…-0001). Invitee is
-- a FRESH auth.users row (no profile/membership) — mirrors 0027. Same conventions as
-- 0027: whole file in a rolled-back transaction; seed assumed present.
-- request.jwt.claims stamps auth.uid(); throws_ok uses the errcode form with NULL
-- message (house style). #0 captures the minted token via \gset for #1 to accept.
-- =============================================================================
begin;
select plan(4);

-- Fresh invitee U2: a real auth.users row (satisfies profiles.id FK) with no profile
-- or membership yet. Mirrors the seed's minimal auth.users insert shape.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '0b0b0b0b-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated',
  'invitee-u2@meritflow.test', extensions.crypt('password123', extensions.gen_salt('bf')),
  now(), now(), now(), '', '', '', ''
);

-- ---------------------------------------------------------------------------
-- (#0) create: inviter = Org A owner -> create_invitation returns a token; an
--      invitations row exists for Org A with role='employee', status='pending'.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

select public.create_invitation('test@x.com', 'employee') as inv_token \gset

select ok(
  exists (
    select 1 from public.invitations i
    where i.token = :'inv_token'::uuid
      and i.organization_id = 'a0000000-0000-0000-0000-000000000001'
      and i.email = 'test@x.com'
      and i.role = 'employee'
      and i.status = 'pending'
      and i.token is not null
  ),
  'create: create_invitation mints a pending employee invitation for Org A with a non-null token'
);

-- ---------------------------------------------------------------------------
-- (#1) accept: invitee = U2 -> accept_invitation creates (orgA, U2, employee, active)
--      membership, marks the invite accepted, and sets the profile display_name.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"0b0b0b0b-0000-0000-0000-0000000000c2","role":"authenticated"}', true);

select public.accept_invitation(:'inv_token'::uuid, 'Yeni Üye') as accept_org \gset

select ok(
  exists (
    select 1 from public.memberships m
    where m.organization_id = 'a0000000-0000-0000-0000-000000000001'
      and m.profile_id = '0b0b0b0b-0000-0000-0000-0000000000c2'
      and m.primary_role = 'employee'
      and m.status = 'active'
  )
  and exists (
    select 1 from public.invitations i
    where i.token = :'inv_token'::uuid and i.status = 'accepted'
  )
  and exists (
    select 1 from public.profiles p
    where p.id = '0b0b0b0b-0000-0000-0000-0000000000c2' and p.display_name = 'Yeni Üye'
  ),
  'accept: accept_invitation creates active employee membership + marks invite accepted + sets profile name'
);

-- ---------------------------------------------------------------------------
-- (#2) expired: a pending invitation whose expires_at is already in the past
--      cannot be accepted -> invitation_not_found_or_expired (23514).
-- ---------------------------------------------------------------------------
insert into public.invitations (organization_id, invited_by, email, role, token, status, expires_at)
values (
  'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1',
  'expired@x.com', 'employee', '0c0c0c0c-0000-0000-0000-0000000000e1', 'pending',
  now() - interval '1 hour'
);

select throws_ok(
  $$ select public.accept_invitation('0c0c0c0c-0000-0000-0000-0000000000e1'::uuid, 'X') $$,
  '23514', NULL, 'expired invitation -> 23514 invitation_not_found_or_expired'
);

-- ---------------------------------------------------------------------------
-- (#3) owner invite: inviter = Org A owner cannot invite the 'owner' role
--      -> cannot_invite_owner (23514).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

select throws_ok(
  $$ select public.create_invitation('x@y.com', 'owner') $$,
  '23514', NULL, 'invite role owner -> 23514 cannot_invite_owner'
);

select * from finish();
rollback;
