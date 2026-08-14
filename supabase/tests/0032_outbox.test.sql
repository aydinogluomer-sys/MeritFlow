-- =============================================================================
-- pgTAP — ENGINEERING-09: outbox_events (transactional outbox) DB behavior.
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: migration 0037. Proves: idempotent enqueue, claim (pending -> processing + attempts++),
--       backoff (future available_at not claimed), and RLS (auditor-only read + FORCE).
-- Uses the seeded Org C (c...003) + its HR (c3, non-auditor) / Auditor (c6), like 0015/0016.
-- =============================================================================
begin;
select no_plan();

-- ---- table + RLS shape -------------------------------------------------------
select has_table('public', 'outbox_events', 'outbox_events table exists');
select ok(
  (select relrowsecurity from pg_class where relname = 'outbox_events' and relnamespace = 'public'::regnamespace),
  'RLS ENABLED on outbox_events');
select ok(
  (select relforcerowsecurity from pg_class where relname = 'outbox_events' and relnamespace = 'public'::regnamespace),
  'RLS FORCED on outbox_events');

-- ---- idempotent enqueue ------------------------------------------------------
select public.enqueue_outbox_event('c0000000-0000-0000-0000-000000000003', 'demo.event', '{"a":1}'::jsonb, 'idem-1');
select public.enqueue_outbox_event('c0000000-0000-0000-0000-000000000003', 'demo.event', '{"a":2}'::jsonb, 'idem-1'); -- duplicate
select is(
  (select count(*) from public.outbox_events
   where organization_id = 'c0000000-0000-0000-0000-000000000003' and idempotency_key = 'idem-1'),
  1::bigint, 'idempotent enqueue: exactly one row per (org, idempotency_key)');

-- ---- claim moves pending -> processing + increments attempts -----------------
select is(
  (select count(*) from public.claim_outbox_events(10) where idempotency_key = 'idem-1'),
  1::bigint, 'claim returns the due pending event');
select is(
  (select status from public.outbox_events
   where organization_id = 'c0000000-0000-0000-0000-000000000003' and idempotency_key = 'idem-1'),
  'processing', 'claim marks the event processing');
select is(
  (select attempts from public.outbox_events
   where organization_id = 'c0000000-0000-0000-0000-000000000003' and idempotency_key = 'idem-1'),
  1, 'claim increments attempts to 1');

-- ---- backoff: a future available_at pending event is NOT claimed -------------
select public.enqueue_outbox_event('c0000000-0000-0000-0000-000000000003', 'demo.event', '{}'::jsonb, 'idem-future');
update public.outbox_events set available_at = now() + interval '1 hour' where idempotency_key = 'idem-future';
select is(
  (select count(*) from public.claim_outbox_events(10)),
  0::bigint, 'backoff: no claimable events (processing not re-claimed; future available_at skipped)');

-- ---- RLS: auditor-only read --------------------------------------------------
set local role authenticated;

-- HR C (c3) is NOT an auditor -> sees no outbox rows.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c3"}', true);
select is(
  (select count(*) from public.outbox_events),
  0::bigint, 'RLS: non-auditor (HR) cannot read outbox_events');

-- Auditor C (c6) reads the Org C outbox rows.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-0000000000c6"}', true);
select ok(
  (select count(*) from public.outbox_events) >= 1,
  'RLS: auditor reads Org C outbox_events');

reset role;

select * from finish();
rollback;
