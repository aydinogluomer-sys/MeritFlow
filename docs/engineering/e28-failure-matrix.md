# ENGINEERING-28 — Failure Injection Matrix

Proves MeritFlow's durable-async / observability failure contract by injecting each failure mode and
asserting the expected behavior. No production code changed — the behavior is already correct; E28
proves it. The outbox drain worker (`src/modules/outbox/application/drain-outbox.ts`) is the focus:
`repo.claim()` is intentionally NOT wrapped in try/catch (infra failure must surface), while every
handler failure is contained inside the per-event loop (the worker never throws for a handler error).

## Matrix

| Failure                          | Injection point                          | Expected behavior                                   | Test |
| -------------------------------- | ---------------------------------------- | --------------------------------------------------- | ---- |
| DB timeout / 503 (claim)         | `repo.claim` throws                      | `drainOutbox` re-throws (propagates; no silent catch)| Scenario 1 |
| Handler 429 / 500 / timeout      | handler throws, `attempts < max_attempts`| `markRetry` with bounded backoff; no throw           | Scenario 2 + 5 |
| Handler exhausted                | handler throws, `attempts >= max_attempts`| `markDead` (dead-letter); no throw                   | Scenario 3 |
| No handler registered            | unknown `event_type`                     | `markDead` immediately (permanent); no throw         | Scenario 4 |
| Poison event                     | handler always throws                    | dead-letter after `max_attempts` (retries bounded)   | Scenario 6 |
| Duplicate delivery               | `claim` returns the same event 2×        | handler + `markCompleted` called twice (at-least-once)| Scenario 7 |
| Notification failure             | `bonus_accrual_notification` handler throws | dead-letter; committed financial write unaffected  | Scenario 8 |
| Telemetry provider throws        | `provider.captureException` throws       | request path unaffected (capture never throws)       | `tests/unit/telemetry/provider.test.ts` |
| Stable commandId retry           | same command UUID re-sent                | no duplicate calculation run (idempotent)            | `tests/unit/commands/run-calculation-idempotency.test.ts` |

Scenarios 1–8 live in `tests/unit/outbox/drain-outbox.failure.test.ts`.

## Backoff

Retry backoff is `30 * 2^(attempts-1)` seconds (`BACKOFF_BASE_SECONDS = 30`): attempt 1 → 30s,
attempt 2 → 60s, attempt 3 → 120s (Scenario 5). Retries are bounded by `max_attempts`; on exhaustion
the event is dead-lettered with an audit trail (`markDead`), never retried forever.

## Financial vs notification separation (Scenario 8)

The financial commit (e.g. the `bonus_calculation_run` row) is persisted in Postgres BEFORE the
outbox event is dispatched. Notification delivery is a separate, later step consumed by the drain
worker. If it fails, only the notification is retried / dead-lettered — the financial calculation is
never rolled back or re-run by a notification failure. A dead-letter leaves an auditable record; it
does not mask a financial problem.
