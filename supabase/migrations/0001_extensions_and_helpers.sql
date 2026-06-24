-- =============================================================================
-- Migration 0001 — Extensions & common helpers
-- Phase 3A: Database Foundation & RBAC
-- Refs: docs/planning/17 (§5, §12 step 2), 14_DATA_DICTIONARY, ADR-003/004
-- No RLS here yet; only extensions and shared trigger functions.
-- =============================================================================

-- gen_random_uuid() is built-in (pgcrypto) on Supabase; ensure available.
create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- set_updated_at(): generic BEFORE UPDATE trigger to maintain updated_at.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Generic BEFORE UPDATE trigger: stamps updated_at = now().';

-- -----------------------------------------------------------------------------
-- prevent_mutation(): enforce APPEND-ONLY tables (blocks UPDATE/DELETE).
-- Used by audit_logs in 3A (point_ledger / bonus_ledger arrive in later slices).
-- SECURITY DEFINER so the block also applies to bypassrls roles attempting
-- UPDATE/DELETE; INSERT is unaffected.
-- -----------------------------------------------------------------------------
create or replace function public.prevent_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'append-only: % on % is not permitted', tg_op, tg_table_name
    using errcode = 'restrict_violation';
  return null;
end;
$$;

comment on function public.prevent_mutation() is
  'Append-only guard: raises on UPDATE/DELETE. Attach to immutable ledgers/audit.';
