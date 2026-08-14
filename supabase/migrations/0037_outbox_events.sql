-- =============================================================================
-- Migration 0037 — outbox_events: transactional outbox + durable async jobs. ENGINEERING-09.
-- Refs: roadmap ENGINEERING-09 (minimal viable outbox), CLAUDE.md (RLS on every table;
--       PostgreSQL source of truth). Local dev/staging only — never production (ADR-014).
--
-- Minimal viable outbox: a durable event queue with idempotent enqueue, exponential-backoff
-- retries, and a dead-letter terminal state. Server-only writes (the worker uses the
-- service_role/admin client via SECURITY DEFINER RPCs); authenticated gets read-only
-- observability for AUDITORS. NOT append-only (status mutates pending -> processing ->
-- completed/dead). No audit trigger — this is internal plumbing, not one of the audited
-- business mutations (manual adjustment / approval / dispute / payout / policy / lock).
-- =============================================================================

create table public.outbox_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type      text not null,
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status          text not null default 'pending',
  attempts        int  not null default 0,
  max_attempts    int  not null default 5,
  available_at    timestamptz not null default now(), -- backoff gate: not claimable before this
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  processed_at    timestamptz,
  constraint outbox_events_status_chk check (status in ('pending', 'processing', 'completed', 'dead')),
  constraint outbox_events_attempts_chk check (attempts >= 0),
  constraint outbox_events_max_attempts_chk check (max_attempts >= 1),
  -- Idempotency: one event per (org, idempotency_key). A duplicate enqueue is a no-op.
  constraint outbox_events_idem_uq unique (organization_id, idempotency_key)
);

comment on table public.outbox_events is
  'Transactional outbox / durable async job queue (ENGINEERING-09). Idempotent enqueue per '
  '(org, idempotency_key); exponential backoff via available_at; dead-letter terminal state. '
  'Server-only writes; RLS read auditor-only. Internal infra (no audit trigger).';

create index idx_outbox_events_org_status on public.outbox_events (organization_id, status);
-- Partial claim index: the worker scans only claimable (pending + due) rows.
create index idx_outbox_events_claim on public.outbox_events (available_at) where status = 'pending';

create trigger trg_outbox_events_set_updated_at
  before update on public.outbox_events
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- enqueue_outbox_event(): idempotent enqueue. Atomic single insert; a duplicate
-- (org, idempotency_key) is a no-op and returns the existing id. SECURITY DEFINER so a
-- producer can enqueue regardless of the outbox RLS (writes are server-only). A caller that
-- needs the event to commit ATOMICALLY with a business change calls this from WITHIN that same
-- DB function/transaction (transactional-outbox guarantee — see docs/runbooks/outbox.md).
-- -----------------------------------------------------------------------------
create or replace function public.enqueue_outbox_event(
  p_organization_id uuid,
  p_event_type      text,
  p_payload         jsonb,
  p_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.outbox_events (organization_id, event_type, payload, idempotency_key)
  values (p_organization_id, p_event_type, coalesce(p_payload, '{}'::jsonb), p_idempotency_key)
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.outbox_events
    where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  end if;
  return v_id;
end;
$$;

comment on function public.enqueue_outbox_event(uuid, text, jsonb, text) is
  'Idempotent outbox enqueue (one row per org+idempotency_key). SECURITY DEFINER; server-only.';

-- -----------------------------------------------------------------------------
-- claim_outbox_events(): atomically claim up to p_limit DUE pending events (backoff respected),
-- moving them pending -> processing and incrementing attempts. FOR UPDATE SKIP LOCKED makes
-- concurrent workers safe (no double-processing). SECURITY DEFINER (the worker runs system-wide).
-- Returns the claimed rows for the worker to dispatch.
-- -----------------------------------------------------------------------------
create or replace function public.claim_outbox_events(p_limit int default 10)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimable as (
    select e.id
    from public.outbox_events e
    where e.status = 'pending' and e.available_at <= now()
    order by e.available_at
    for update skip locked
    limit greatest(p_limit, 1)
  )
  update public.outbox_events o
  set status = 'processing', attempts = o.attempts + 1, updated_at = now()
  from claimable c
  where o.id = c.id
  returning o.*;
end;
$$;

comment on function public.claim_outbox_events(int) is
  'Atomically claims up to N due pending events (FOR UPDATE SKIP LOCKED), marking them '
  'processing and incrementing attempts. Worker-only (SECURITY DEFINER).';

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege. Server-only writes; auditor read-only observability.
-- =============================================================================
alter table public.outbox_events enable row level security;
alter table public.outbox_events force row level security;
revoke all on public.outbox_events from anon, authenticated;
grant select on public.outbox_events to authenticated;
grant all on public.outbox_events to service_role;

create policy outbox_events_select on public.outbox_events
  for select to authenticated
  using (organization_id = public.current_org() and public.has_role('auditor'));
-- No INSERT/UPDATE/DELETE policy (server-only writes via service_role / SECURITY DEFINER RPCs).

grant execute on function public.enqueue_outbox_event(uuid, text, jsonb, text) to authenticated, service_role;
grant execute on function public.claim_outbox_events(int) to authenticated, service_role;
