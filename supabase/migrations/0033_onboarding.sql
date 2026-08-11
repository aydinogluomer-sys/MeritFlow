-- =============================================================================
-- Migration 0033 — Onboarding-A: org creation bootstrap
-- Decision (a): MULTI-ORG allowed, NO double-join guard — upholds Decision Lock
--   ("bir kullanıcı birden çok org'da farklı role sahip olabilir"). A user may
--   own/join any number of orgs; create_organization deliberately does NOT check
--   for an existing membership.
-- Refs: 0002 (organizations/profiles), 0003 (memberships/roles 'owner'),
--       0005 (audit_logs append-only), 0006 (SECURITY DEFINER + revoke/grant style).
--
-- create_organization(): bootstrap RPC. A newly-authenticated user has NO membership
-- yet, so RLS cannot help them create their first org — this SECURITY DEFINER function
-- (owned by the migration role, BYPASSRLS) atomically creates the org + owner
-- membership + profile + audit row. Server-only; granted to `authenticated`; identity
-- comes from auth.uid() (never a JWT-claimed org). Local-dev-only migration.
-- =============================================================================

create function public.create_organization(
  p_name         text,
  p_slug         text,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'invalid_slug_format' using errcode = '22023';
  end if;

  insert into public.organizations (name, slug)
  values (p_name, p_slug)
  returning id into v_org_id;

  insert into public.profiles (id, display_name)
  values (auth.uid(), p_display_name)
  on conflict (id) do nothing;

  insert into public.memberships (organization_id, profile_id, primary_role, status)
  values (v_org_id, auth.uid(), 'owner', 'active');

  insert into public.audit_logs (organization_id, actor_id, action, target_type, target_id)
  values (v_org_id, auth.uid(), 'org.created', 'organizations', v_org_id);

  return v_org_id;
end;
$$;

comment on function public.create_organization(text, text, text) is
  'Onboarding bootstrap: creates org + owner membership atomically (SECURITY DEFINER, bypasses RLS). Multi-org allowed per Decision Lock — no double-join guard.';

revoke execute on function public.create_organization(text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;
