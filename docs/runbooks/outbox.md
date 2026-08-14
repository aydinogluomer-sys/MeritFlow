# Outbox Runbook (ENGINEERING-09)

A minimal, durable async-job queue for MeritFlow — the transactional-outbox pattern kept
deliberately small (no Kafka / Redis-queue / event-sourcing). PostgreSQL is the source of truth;
the outbox is a table, a claim RPC, and a drain worker.

## When to use the outbox (and when NOT to)

Use it only for work that must survive a crash and run **after** a business change commits:
email/notification delivery, webhooks, payroll/export side effects, long calculations, external
integrations, reconciliation triggers. Do **not** route synchronous, in-request work through it,
and never make it the source of financial truth — that stays in the ledgers (append-only) and the
snapshots (immutable).

## Data model (`0037_outbox_events`)

`outbox_events` — `status` pending → processing → completed | dead; `attempts` / `max_attempts`;
`available_at` (backoff gate); `idempotency_key` unique per org; `payload` jsonb; `last_error`.
RLS ENABLE + FORCE, server-only writes, auditor-only read (observability). Not append-only; not
audited (internal plumbing, not a business mutation).

## Idempotency + transactional guarantee

- **Enqueue is idempotent** per `(organization_id, idempotency_key)` — a duplicate enqueue is a
  no-op that returns the existing id (`enqueue_outbox_event`, `ON CONFLICT DO NOTHING`).
- **Transactional-outbox guarantee:** to guarantee the event commits atomically with a business
  change, call `enqueue_outbox_event(...)` from **within the same DB function/transaction** as
  that change (e.g. inside a SECURITY DEFINER RPC that also writes the business row). The provided
  RPC is the building block; producers that enqueue from a separate app call get at-least-once
  *after* their write, not atomic-with-it. (Retrofitting existing RPCs is out of MVP scope.)

## Worker model (claim → dispatch → mark)

`claim_outbox_events(limit)` atomically claims up to N **due** pending rows
(`available_at <= now()`), moving them to `processing` and incrementing `attempts`, using
`FOR UPDATE SKIP LOCKED` so concurrent workers never double-process. `drainOutbox` then dispatches
each event to its handler in `DEFAULT_OUTBOX_HANDLERS` and records the outcome:

| Outcome | Transition |
| --- | --- |
| handler succeeds | `completed` |
| handler throws, `attempts < max_attempts` | back to `pending`, `available_at = now() + 30s·2^(attempts-1)` (**retried**) |
| handler throws, `attempts >= max_attempts` | `dead` (**dead-letter**) |
| no handler for `event_type` | `dead` (permanent; unknown event) |

Delivery is **at-least-once** → handlers **must be idempotent**.

## Triggering the drain

MVP exposes `drainOutboxAction` (`period.manage`) — a system-wide drain intended to be invoked by
a scheduled job (Vercel Cron / an external scheduler), not a per-user request. In production the
drain should run under a system/service context on a fixed cadence. `DEFAULT_OUTBOX_HANDLERS` is
empty today (no producer wired), so the drain is a safe no-op scaffold until the first real
handler + producer land.

## Operating the queue

- **Backlog:** `select count(*) from outbox_events where status = 'pending' and available_at <= now();`
- **Dead-letters:** `select * from outbox_events where status = 'dead' order by updated_at desc;`
  — inspect `last_error`, fix the handler or data, then re-queue by setting
  `status='pending', available_at=now(), attempts=0` (server-only).
- **Retention:** completed rows can be pruned by a periodic cleanup (server-only DELETE); keep
  dead-letters until triaged.

## Deliberately NOT included

Kafka / Redis Streams / complex topologies; event-sourcing; a bespoke scheduler daemon. If a
managed runner is adopted later (Inngest / Trigger.dev — V1 stack note), it wraps this same table.
