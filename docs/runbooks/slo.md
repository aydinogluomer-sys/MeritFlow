# SLOs, Error Budget & Alerting Runbook (ENGINEERING-12)

Service-level objectives for MeritFlow and what to alert on. Scoped to the ICP (an SME with a
monthly bonus cycle) — targets are pragmatic, not hyperscale.

> Observability is errors + operational signals only — **no employee monitoring** (ADR-016). Sentry
> is a documented no-op today (`@sentry/nextjs` is not Next-16-compatible); server errors flow through
> `captureServerError` (ENGINEERING-04), which has an optional `@sentry/node` path. Wire the alerts
> below to whatever provider is chosen; this runbook is provider-agnostic.

## 1. SLIs (what we measure)

| SLI | Signal | Source |
| --- | --- | --- |
| **Availability** | `GET /api/health` returns `{ status: 'ok' }` | health route / uptime monitor |
| **Read latency** | p95 of hot read paths | `docs/runbooks/performance.md` budgets + `perf-smoke` |
| **Error rate** | rate of `INTERNAL` DomainError / unhandled server errors | `captureServerError` + structured logger (ENGINEERING-04) |
| **Financial correctness** | reconciliation invariants pass | reconciliation verifier (ENGINEERING-05) |
| **Schema integrity** | no drift; migrations applied | `db` job drift check + pgTAP `0031` |

## 2. SLOs (targets)

Targets to validate and tune after the first weeks of real traffic.

| Objective | Target (monthly) |
| --- | --- |
| Availability | **≥ 99.5%** (`/api/health` success) |
| Read latency (selective hot queries) | p95 within the [performance.md](performance.md) budget; no `Seq Scan` on a large selective query (gated by `perf-smoke`) |
| Server error rate | **< 0.5%** of server requests result in an `INTERNAL` error |
| Financial correctness | **100%** — reconciliation must never have an unresolved CRITICAL mismatch |

Correctness is **not** budgeted: a financial invariant violation is always SEV1
([incident-response.md](incident-response.md)), never "within budget".

## 3. Error budget

- Availability 99.5%/month ≈ **~3h 39m** of allowed downtime per 30 days.
- Track budget burn from the uptime monitor. Sustained burn (e.g. >2× the linear rate) → freeze
  risky deploys, prioritize reliability work.
- Latency: treat a sustained ≥2× regression at a fixed perf profile as a burn event (performance.md).

## 4. What to alert on

| Alert | Condition | Severity | Route |
| --- | --- | --- | --- |
| Health down | `/api/health` failing for > 2 min | SEV1 | incident-response |
| DB unreachable | health `db: 'unknown'` sustained, or connection errors | SEV1 | incident-response + DR |
| Reconciliation CRITICAL | any critical invariant mismatch | SEV1 | incident-response §3 (integrity) |
| Error-rate spike | `INTERNAL` error rate over threshold | SEV2 (SEV1 if financial paths) | incident-response |
| Latency breach | hot-query p95 over budget sustained | SEV2 | performance.md |
| Schema drift / failed migration | `deploy` dry-run diff unexpected, or push failure | SEV1 | migration-safety + environments |
| Deploy failure | prod deploy/migration workflow fails | SEV2 | environments-and-deploy |
| Secret exposure | gitleaks hit / leaked key | SEV1 | incident-response §4 (rotate) |

Escalation: every SEV1 alert opens an incident (incident-response.md) and, if financial impact is
possible, notifies HR/Finance.

## 5. Recommended wiring (operator)

- **Uptime:** external monitor hitting `/api/health` every minute (availability SLI + health alert).
- **Errors:** set `SENTRY_DSN` (+ a Next-16-compatible SDK, or the `@sentry/node` path) so
  `captureServerError` reports `INTERNAL` errors; alert on rate.
- **Correctness:** schedule the reconciliation verifier (e.g. a cron/worker post-calculation) and
  alert on any CRITICAL result — this is the most important MeritFlow-specific alert.
- **Dashboard:** availability, p95 latency, error rate, last reconciliation status, last successful
  backup/restore-drill date.

## 6. Evidence (fill in — required for DoD)

| Item | Status |
| --- | --- |
| Uptime monitor on `/api/health` active | _pending_ |
| Error reporting wired + a test alert **fired and verified** | _pending_ |
| Reconciliation scheduled + CRITICAL alert verified | _pending_ |
| SLO dashboard active | _pending_ |

**ENGINEERING-12 is not "done" for SLO/alerting until an alert has actually fired and been verified
end-to-end (not just configured).**
