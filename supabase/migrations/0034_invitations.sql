-- =============================================================================
-- Migration 0034 — Onboarding-B: member invite + join
-- Refs: 0033 (create_organization bootstrap pattern: auth.uid() null guard, audit
--       insert, SECURITY DEFINER + fixed empty search_path, grant to authenticated),
--       0002 (organizations/profiles), 0003 (memberships unique(org,profile) + roles),
--       0005 (audit_logs append-only), 0006 (current_org/has_permission helpers),
--       0007:128-148 (memberships RLS uses has_permission('user.invite')).
--
-- invitations: a tenant-scoped pending invite (no email delivery in MVP — the caller
-- receives the token and shares a /join?token=<uuid> link). RLS lets only users with
-- user.invite in the active org read the org's invitations.
--
-- create_invitation(): SECURITY DEFINER RPC. An org admin (user.invite) mints an invite
-- for an email + role (never 'owner'); returns the token. Identity via auth.uid().
--
-- accept_invitation(): SECURITY DEFINER RPC. The invitee has NO membership yet, so RLS
-- cannot help them — this function (owned by the migration role, BYPASSRLS) atomically
-- validates the token, creates/updates the profile, creates the membership, marks the
-- invite accepted, and writes an audit row. Local-dev-only migration.
-- =============================================================================

create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invited_by      uuid not null references public.profiles(id),
  email           text not null,
  role            text not null references public.roles(key),
  token           uuid not null default gen_random_uuid(),
  status          text not null default 'pending',
  expires_at      timestamptz not null default now() + interval '7 days',
  created_at      timestamptz not null default now(),
  constraint invitations_token_key    unique (token),
  constraint invitations_status_chk   check (status in ('pending','accepted','expired','cancelled')),
  constraint invitations_role_not_owner check (role <> 'owner')
);

alter table public.invitations enable row level security;
alter table public.invitations force row level security;
revoke all on public.invitations from anon, authenticated;
grant select on public.invitations to authenticated;
grant all on public.invitations to service_role;

create policy invitations_select on public.invitations
  for select to authenticated
  using (organization_id = public.current_org() and public.has_permission('user.invite'));

create function public.create_invitation(p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_token uuid; v_org uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if not public.has_permission('user.invite') then raise exception 'permission_denied' using errcode = '42501'; end if;
  if p_role = 'owner' then raise exception 'cannot_invite_owner' using errcode = '23514'; end if;
  v_org := public.current_org();
  if v_org is null then raise exception 'no_active_org' using errcode = '23514'; end if;
  insert into public.invitations (organization_id, invited_by, email, role)
  values (v_org, auth.uid(), p_email, p_role) returning token into v_token;
  insert into public.audit_logs (organization_id, actor_id, action, target_type)
  values (v_org, auth.uid(), 'member.invited', 'invitations');
  return v_token;
end; $$;

comment on function public.create_invitation(text, text) is
  'Onboarding-B: creates invitation; no email (MVP). Returns token UUID — caller builds /join?token=<uuid>.';
revoke execute on function public.create_invitation(text, text) from public, anon;
grant execute on function public.create_invitation(text, text) to authenticated;

create function public.accept_invitation(p_token uuid, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_inv record;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  select id, organization_id, role into v_inv from public.invitations
  where token = p_token and status = 'pending' and expires_at > now();
  if not found then raise exception 'invitation_not_found_or_expired' using errcode = '23514'; end if;
  insert into public.profiles (id, display_name) values (auth.uid(), p_display_name)
  on conflict (id) do update set display_name = excluded.display_name where public.profiles.display_name = '';
  insert into public.memberships (organization_id, profile_id, primary_role, status)
  values (v_inv.organization_id, auth.uid(), v_inv.role, 'active');
  update public.invitations set status = 'accepted' where id = v_inv.id;
  insert into public.audit_logs (organization_id, actor_id, action, target_type)
  values (v_inv.organization_id, auth.uid(), 'member.joined', 'invitations');
  return v_inv.organization_id;
end; $$;

comment on function public.accept_invitation(uuid, text) is
  'Onboarding-B: validates token, creates membership + profile atomically (SECURITY DEFINER — invitee has no membership yet). Returns org_id.';
revoke execute on function public.accept_invitation(uuid, text) from public, anon;
grant execute on function public.accept_invitation(uuid, text) to authenticated;
