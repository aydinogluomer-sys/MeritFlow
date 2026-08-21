-- =============================================================================
-- Migration 0041 — ENGINEERING-19 (8.4): Postgres-atomic sensitive-mutation rate limiter.
-- Provider-neutral (no Redis): a fixed-window counter, incremented atomically via an ON CONFLICT
-- upsert inside a SECURITY DEFINER RPC. Per (operation-key, organization_id, window). Server-only.
-- RLS ENABLED + FORCE per CLAUDE.md (the spec draft said "no RLS" — overridden: every table carries
-- RLS; writes are server-only via the SECURITY DEFINER RPC, which bypasses RLS as the owner).
-- SECURITY DEFINER + fixed search_path = '' (§7A / ADR-014). Local dev/staging only.
-- =============================================================================

create table if not exists public.rate_limit_counters (
  key             text        not null,
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  window_start    timestamptz not null,
  count           int         not null default 1,
  constraint rate_limit_counters_pkey primary key (key, organization_id, window_start)
);

comment on table public.rate_limit_counters is
  'Fixed-window rate-limit counters (ENGINEERING-19). One row per (key, org, window_start). '
  'Server-only writes via the SECURITY DEFINER check_rate_limit() RPC. Stale windows pruned lazily.';

-- RLS (ENABLE + FORCE) — deny all client access; the RPC (SECURITY DEFINER) is the only writer.
alter table public.rate_limit_counters enable row level security;
alter table public.rate_limit_counters force row level security;
revoke all on public.rate_limit_counters from anon, authenticated;
grant all on public.rate_limit_counters to service_role;
-- No SELECT/INSERT/UPDATE/DELETE policy: all access is server-only via check_rate_limit().

-- -----------------------------------------------------------------------------
-- check_rate_limit(): atomic fixed-window increment. Returns true = allowed, false = limited.
-- The window is aligned to p_window_seconds boundaries so concurrent callers share one row and the
-- ON CONFLICT increment is a single atomic statement (no read-modify-write race).
-- -----------------------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_key             text,
  p_organization_id uuid,
  p_max_requests    int,
  p_window_seconds  int
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count        int;
begin
  v_window_start := date_trunc('second', now()) -
                    make_interval(secs => (extract(epoch from now())::int % p_window_seconds));

  insert into public.rate_limit_counters (key, organization_id, window_start, count)
  values (p_key, p_organization_id, v_window_start, 1)
  on conflict (key, organization_id, window_start)
  do update set count = public.rate_limit_counters.count + 1
  returning count into v_count;

  return v_count <= p_max_requests;
end;
$$;

comment on function public.check_rate_limit(text, uuid, int, int) is
  'ENGINEERING-19 fixed-window rate limit: atomic ON CONFLICT increment per (key, org, window). '
  'Returns true when count <= p_max_requests, false when the limit is exceeded. SECURITY DEFINER.';

-- Opportunistic cleanup of stale windows (no separate cron in MVP).
create or replace function public.prune_rate_limit_counters()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rate_limit_counters where window_start < now() - interval '1 day';
$$;

comment on function public.prune_rate_limit_counters() is
  'Deletes rate_limit_counters rows older than 1 day (opportunistic cleanup). SECURITY DEFINER.';

revoke execute on function public.check_rate_limit(text, uuid, int, int) from public, anon;
grant execute on function public.check_rate_limit(text, uuid, int, int) to service_role;
revoke execute on function public.prune_rate_limit_counters() from public, anon;
grant execute on function public.prune_rate_limit_counters() to service_role;
