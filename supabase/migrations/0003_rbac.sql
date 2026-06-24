-- =============================================================================
-- Migration 0003 — RBAC
-- Phase 3A: roles, permissions, role_permissions (global catalog), memberships
-- Refs: 14_DATA_DICTIONARY (RBAC), 04_ROLE_PERMISSION_MATRIX, Decision Lock AD1/AD2/D4
--   - roles / permissions / role_permissions : GLOBAL catalog → NO organization_id (§8A)
--   - memberships : tenant anchor → organization_id; ONE primary_role per org (AD2)
-- Authorization source of truth = role_permissions (DB), never JWT (AD1).
-- Implementation note: primary team is canonical via team_memberships.is_primary
-- (migration 0004), NOT a memberships column — single source of truth (AD9),
-- refining 14_DATA_DICTIONARY's dual representation to avoid drift.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- roles (global system catalog — D4)
-- -----------------------------------------------------------------------------
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text not null,
  label       text not null,
  description text,
  is_system   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint roles_key_key unique (key),
  constraint roles_key_chk
    check (key in ('owner', 'admin', 'hr', 'finance', 'manager', 'employee', 'auditor'))
);

comment on table public.roles is
  'Global RBAC role catalog (MVP fixed taxonomy — D4). NO organization_id (§8A). '
  'Custom org roles are V1.';

-- -----------------------------------------------------------------------------
-- permissions (global catalog)
-- -----------------------------------------------------------------------------
create table public.permissions (
  id           uuid primary key default gen_random_uuid(),
  key          text not null,
  label        text not null,
  domain       text not null,
  description  text,
  is_sensitive boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint permissions_key_key unique (key)
);

comment on table public.permissions is
  'Global permission catalog. NO organization_id (§8A). Authz reads via DB (AD1).';

-- -----------------------------------------------------------------------------
-- role_permissions (global role→permission mapping; org-override is V1)
-- -----------------------------------------------------------------------------
create table public.role_permissions (
  id              uuid primary key default gen_random_uuid(),
  role_key        text not null references public.roles(key) on delete cascade,
  permission_key  text not null references public.permissions(key) on delete cascade,
  constraint_meta jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint role_permissions_uq unique (role_key, permission_key)
);

comment on table public.role_permissions is
  'Global role→permission mapping = server-side authorization source (AD1). '
  'NO organization_id (§8A). Org-specific override is V1.';

-- -----------------------------------------------------------------------------
-- memberships (tenant anchor — RLS anchor; ONE primary_role per (org,profile))
-- -----------------------------------------------------------------------------
create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  primary_role    text not null references public.roles(key),
  status          text not null default 'active',
  invited_by      uuid references public.profiles(id),
  joined_at       timestamptz not null default now(),
  deactivated_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- One active membership per (org, profile) => single primary_role (AD2).
  constraint memberships_org_profile_uq unique (organization_id, profile_id),
  constraint memberships_status_chk check (status in ('active', 'pending', 'deactivated'))
);

comment on table public.memberships is
  'Tenant RLS anchor. (organization_id, profile_id, primary_role). '
  'Single primary_role per org (AD2). Sensitivity: confidential. Audited.';

create index idx_memberships_org_profile on public.memberships (organization_id, profile_id);
create index idx_memberships_primary_role on public.memberships (organization_id, primary_role);
create index idx_memberships_profile on public.memberships (profile_id);

create trigger trg_memberships_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();
