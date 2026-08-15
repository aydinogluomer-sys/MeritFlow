# Performance Runbook (ENGINEERING-10)

ICP-driven performance testing for MeritFlow's hot read paths — no vanity 1M-row benchmarks.
Measures query **plans** (structural) and timing at the ICP scale and under 3×/10× stress, and
gates CI on a **structural** regression (a selective query seq-scanning a large table).

## ICP + profiles

MeritFlow's ICP is an SME (10–250 employees), typically single-org, with a **monthly** bonus
cycle and no surveillance. The perf profiles scale the two largest, seq-scan-risk read surfaces
(`tasks`, `point_ledger`) — volume is what provokes seq-scans; employee cardinality is secondary.

| Profile | `perf.scale` (rows/table) | Rationale |
| --- | --- | --- |
| **expected** | 1000 | ~50 employees × ~20 tasks — a typical ICP org-month. Runs in CI. |
| **3x** | 3000 | ~150 employees / heavy month. Local/on-demand. |
| **10x** | 10000 | ~500 employees stress (top of ICP + headroom). Local/on-demand. |

## Scope decision (important)

The generator (`supabase/perf/seed_perf_dataset.sql`) injects **volume into the seeded Org C**
rather than bootstrapping a fresh N-employee org. Bootstrapping would require `auth.users` rows,
scoring-policy jsonb, and the full engine pipeline (comp / eligibility / approved-points /
run_bonus_calculation / accrual) — none verifiable without a live DB, and highly fragile to write
blind. Org C already has employees, a team, and a published scoring policy; the generator fetches
those ids dynamically and bulk-inserts `tasks` (status `assigned`) + `point_ledger`
(`manual_adjustment`, the only directly-insertable event type). This exercises the real seq-scan
risks with reliably-constructible data. The **finance-view** queries (`v_finance_payout`,
`v_finance_period_totals`) are period-scoped aggregates bounded by employees-per-period — not a
scale risk — so they are measured on the existing (bounded) bonus data, report-only.

## Hot queries measured

| Query | Path | Index it should use | Gate |
| --- | --- | --- | --- |
| `leaderboard` | `get_leaderboard(org, …)` net-points aggregate | full-org aggregate (scan is legitimate) | report-only |
| `tasks-list` | `tasks` where org + status + assignee | `idx_tasks_org_status_assignee` | **seq-scan → fail** |
| `point-ledger-sum` | `point_ledger` sum where org + employee | `idx_point_ledger_org_employee` | **seq-scan → fail** |
| `v_finance_payout` | payout view by `bonus_period_id` | period-scoped | report-only |
| `v_finance_totals` | period-totals view by `bonus_period_id` | period-scoped | report-only |

## Regression budgets

- **Structural (blocking):** a **selective** query (`tasks-list`, `point-ledger-sum`) must NOT
  `Seq Scan` a relation returning > **5000** rows. Full-set aggregates are exempt (scanning the
  whole set is correct). This is the `perf-smoke` CI gate (expected profile only).
- **Timing (report-only):** p95 is logged, not gated — CI runner timing is noisy. Track the
  numbers below across runs; investigate a sustained ≥2× regression at a fixed profile.

## Results (p50 / p95 / p99, ms)

Populated from the `perf-smoke` CI job (expected profile) and local 3×/10× runs. _Numbers are
filled in from the first green CI perf-smoke run; timing is indicative (CI-shared runner)._

| Query | expected p50/p95/p99 | 3× p50/p95/p99 | 10× p50/p95/p99 |
| --- | --- | --- | --- |
| leaderboard | _pending CI_ | _local_ | _local_ |
| tasks-list | _pending CI_ | _local_ | _local_ |
| point-ledger-sum | _pending CI_ | _local_ | _local_ |
| v_finance_payout | _pending CI_ | _local_ | _local_ |
| v_finance_totals | _pending CI_ | _local_ | _local_ |

## Index rationale (existing → hot queries)

The relevant indexes among the 56 already in the schema:

- `idx_tasks_org_status_assignee` (0019) → `tasks-list` (org + status + assignee).
- `idx_point_ledger_org_employee` (0009) → `point-ledger-sum` and the per-employee leaderboard grouping.
- `idx_bonus_allocation_snapshots_period`, `idx_bonus_ledger_*` (0013/0014) → the finance views' joins.

No new index is added in this slice — the point is to *detect* a missing/unused one, not to add
speculative ones (an index that no query needs is write-amplification debt).

## N+1 watch

App-layer read paths delegate to repositories that issue single queries (no in-loop DB calls
observed in `src/modules/*/repository`). The outbox drain (`drainOutbox`) marks each event with a
separate `update` — acceptable at batch sizes ≤ limit; revisit if batch sizes grow.

## Running locally (3× / 10×)

Requires Docker + `supabase start` + `supabase db reset`, then:

```bash
bash scripts/perf-benchmark.sh expected   # 1000 rows/table (the CI profile)
bash scripts/perf-benchmark.sh 3x         # 3000
bash scripts/perf-benchmark.sh 10x        # 10000 — top-of-ICP stress
```

Each run applies the perf dataset (insert-only; a fresh `db reset` first gives clean volume) and
prints per-query p50/p95/p99 + seq-scan flags. Exit 1 on a structural regression.
