-- =============================================================================
-- Migration 0002 — Core tenant identity
-- Phase 3A: organizations, organization_settings, profiles
-- Refs: 14_DATA_DICTIONARY (identity), 13 (org/membership model), §8A org_id rules
--   - organizations  : tenant ROOT  → carries NO organization_id (§8A)
--   - profiles        : GLOBAL identity (auth-bound) → carries NO organization_id (§8A)
--   - organization_settings : tenant-scoped → carries organization_id
-- =============================================================================

-- -----------------------------------------------------------------------------
-- organizations (tenant root)
-- -----------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null,
  currency    text not null default 'TRY',
  status      text not null default 'active',
  locale      text,
  legal_name  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint organizations_slug_key unique (slug),
  constraint organizations_status_chk check (status in ('active', 'suspended'))
);

comment on table public.organizations is
  'Tenant root. No organization_id (it IS the tenant). Sensitivity: internal.';

create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- organization_settings (tenant-scoped, 1-1 with organization)
-- -----------------------------------------------------------------------------
create table public.organization_settings (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  cap_rate_default        numeric not null default 0.50,
  period_type             text not null default 'monthly',
  locale                  text,
  leaderboard_visibility  text not null default 'anonymized',
  winner_overlay_enabled  boolean not null default false,
  anti_gaming_thresholds  jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint organization_settings_org_key unique (organization_id),
  constraint organization_settings_cap_rate_chk check (cap_rate_default >= 0 and cap_rate_default <= 1),
  constraint organization_settings_period_chk check (period_type in ('monthly')),
  constraint organization_settings_leaderboard_chk
    check (leaderboard_visibility in ('anonymized', 'percentile', 'private'))
);

comment on table public.organization_settings is
  'Org default policy (cap_default, locale). Sensitivity: confidential. Audited.';

create trigger trg_organization_settings_updated_at
  before update on public.organization_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- profiles (GLOBAL identity, bound to auth.users; NO organization_id — §8A)
-- Org relationship is expressed only through memberships.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  alias        text,
  avatar_url   text,
  locale       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Global user identity (profile.id = auth.users.id). NO organization_id (§8A). '
  'Org link via memberships. Sensitivity: personal-data.';

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
