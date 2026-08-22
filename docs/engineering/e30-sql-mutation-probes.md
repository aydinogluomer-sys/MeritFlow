# ENGINEERING-30 — SQL Mutation Probes

Mutation testing for the **database layer**. Unit-level Stryker (ENGINEERING-21) proves the TS suite;
this proves the **pgTAP** suite. `scripts/sql-mutation-probe.sh` injects one high-risk mutation into
the migration SQL at a time, applies a fresh DB, runs the full pgTAP suite, then **restores the
migration immediately** (an `EXIT` trap restores any leftover backup even if the run dies). A mutation
the suite still passes = a hole in the SQL tests (**SURVIVED = CI blocker**).

Nothing is ever committed mutated — the script only mutates at runtime and reverts.

## The 10 mutants

| ID  | Migration | Mutation | Kills a guard proven by |
| --- | --------- | -------- | ----------------------- |
| M1  | `0007_rls_enable_and_policies.sql` | `memberships_select_org` USING: `organization_id = current_org()` → `true` (tenant filter removed) | `0001_phase3a_rls` (cross-tenant) |
| M2  | `0012_bonus_components_eligibility.sql` | eligibility `days_active >= 15` → `> 15` (a 15-day employee is excluded) | `0006_phase3_bonus_components_eligibility` |
| M3  | `0021_bonus_engine.sql` | `else least(cap_minor, raw_share_minor)` → `else raw_share_minor` (cap removed) | `0015_phase6_bonus_engine` |
| M4  | `0013_..._snapshots.sql` | comment the `bonus_calculation_runs_idem_uq` unique constraint (idempotency removed) | `0007_phase3_bonus_calc_runs_allocations_snapshots` |
| M5  | `0014_bonus_ledger.sql` | comment `trg_bonus_ledger_balance` (Σdebit = Σcredit no longer enforced) | `0008_phase3_bonus_ledger` / `0016_phase6b_bonus_ledger_accrual` |
| M6  | `0018_exports.sql` | AD6 export block `raise exception` → `raise notice` (export with pending cap succeeds) | `0021_phase6c_payout_export` |
| M7  | `0019_tasks_events_reviews.sql` | self-approval `raise exception` → `raise notice` (self-approval allowed) | `0013_phase4_tasks_reviews` |
| M8  | `0011_bonus_periods_pools.sql` | period-transition `raise exception` → `raise notice` (any transition allowed) | `0005_phase3_bonus_periods_pools` |
| M9  | `0021_bonus_engine.sql` | largest-remainder tie-break `employee_id asc` → `desc` (wrong employee gets +1 kuruş) | `0015_phase6_bonus_engine` |
| M10 | `0013_..._snapshots.sql` | comment `trg_bonus_allocation_snapshots_append_only` (snapshots become UPDATE-able) | `0007_phase3_bonus_calc_runs_allocations_snapshots` |

Each mutation is crafted to produce **valid** SQL (so `db reset` succeeds and the guard is genuinely
disabled): guard `RAISE EXCEPTION`s become `RAISE NOTICE` (valid, non-aborting) rather than being
deleted (which could leave an empty `THEN` block); triggers/constraints are line-commented as whole
statements. The script also fails loudly if a `sed` matches nothing (migration text drifted).

## How to run

Requires Docker + a running local Supabase.

```bash
supabase start                       # boot the local stack
bash scripts/sql-mutation-probe.sh   # ~25 min: 10 × (mutate → db reset → pgTAP → restore)
```

Report: `reports/sql-mutation/report.json` (killed/survived/errored + per-mutant pgTAP logs).

## If a mutant SURVIVES

The pgTAP suite is **weak** for that guard: a wrong implementation slips through. **Strengthen the
pgTAP test** (add the missing assertion) — do NOT weaken the probe. Re-run until all 10 are killed.

## Nightly CI

Runs in `.github/workflows/nightly.yml` (`sql-mutation` job — Docker, separate from the Stryker
mutation job). Any SURVIVED (or a drifted/errored probe) fails the job; the report is uploaded as an
artifact.
