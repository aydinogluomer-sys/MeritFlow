# Disaster Recovery Runbook (ENGINEERING-12)

How MeritFlow recovers from data loss or a corrupted/unavailable database. PostgreSQL (Supabase)
is the single source of truth for all financial data; Redis (if enabled) is cache/read-model only
and is **never** a recovery concern — it is rebuilt from Postgres.

> **Never touch the production database directly** (CLAUDE.md / ADR-014). Recovery is performed
> against a **new/target** project or a Supabase restore, never by hand-editing prod. Supabase MCP
> is staging/dev only.
> **"Backup configured" is NOT done.** This runbook is only satisfied once a **real restore drill**
> has been executed and its evidence recorded in §6. Configuration without a proven restore is not
> disaster recovery.

## 1. What must be recoverable

| Asset | Source of truth | Recovery mechanism |
| --- | --- | --- |
| Postgres (orgs, ledgers, audit, snapshots) | Supabase Postgres | PITR / daily backup restore |
| Auth users | Supabase Auth (same Postgres `auth` schema) | restored with the DB |
| Storage objects (export files, if used) | Supabase Storage | Storage backup / re-generation from snapshots |
| Read-model cache (Upstash Redis, optional V1) | derived | rebuilt from Postgres — not backed up |

The point/bonus ledgers and `audit_logs` are **append-only and immutable** (CLAUDE.md). They cannot
be reconstructed from application logic — the backup **is** the recovery path for financial truth.

## 2. RPO / RTO targets

These are **targets to validate by drill** (§4), not guarantees. Tune after the first measured drill.

| Metric | Target | Basis |
| --- | --- | --- |
| **RPO** (max data loss) | ≤ 5 minutes | Supabase PITR (Pro+) has ~2-minute WAL granularity; daily-backup-only plans have RPO ≤ 24h. |
| **RTO** (time to restore) | ≤ 2 hours | PITR restore of an SME-scale DB + migration parity check + app boot + reconciliation. |
| **Correctness after restore** | 100% invariants | Reconciliation (ENGINEERING-05) + pgTAP integrity must pass before declaring recovery complete. |

MeritFlow's ICP is an SME (10–250 employees, monthly bonus cycle) — data volume is modest, so RTO is
dominated by provisioning + verification, not raw restore time.

## 3. Backup strategy

- **Primary: Supabase PITR** (Pro plan or higher). Enable point-in-time recovery so any timestamp in
  the retention window can be restored. This is the RPO ≤ 5 min mechanism.
- **Secondary: daily automated backups** (Supabase-managed) — the fallback if PITR is unavailable.
- **Tertiary (recommended): periodic offsite logical dump** — a scheduled `pg_dump` (roles + data)
  stored in a separate account/region, guarding against a provider-account compromise. Encrypt at rest.
- Backups include the `auth` schema (users) — do **not** filter it out, or restored users cannot log in.

## 4. Restore drill (the actual DoD)

Run this on a **fresh target** (a new Supabase project or a staging project), never over prod.

1. **Provision** a target project (or use staging). Record start time (`t0`).
2. **Restore** to a chosen recovery point:
   - PITR: restore to a target timestamp `T` (choose one a few minutes in the past).
   - or backup: restore the latest daily backup.
3. **Migration parity:** confirm the restored schema matches the committed migrations —
   `supabase db diff` against the target must be empty (no drift). If the backup predates a
   migration, apply the missing migrations in order.
4. **Boot the app** against the restored DB (`NEXT_PUBLIC_SUPABASE_URL` + keys of the target). Hit
   `/api/health` → `{ status: 'ok' }`.
5. **Reconciliation:** run the financial reconciliation verifier (ENGINEERING-05,
   `runReconciliationAction` / the reconciliation module) — all 5 invariants must pass (pool-sum,
   ledger-balance, missing-snapshot, duplicate-accrual, BL2 over-accrual). Any CRITICAL mismatch
   means the restore is **not** trustworthy.
6. **Integrity:** run the pgTAP suite against the target (`supabase test db`), especially
   `0031_migration_integrity` (seed survived + financial columns present + RLS enabled on ledgers).
7. **Measure:** record `RTO = now - t0` and the effective `RPO = T_incident - T_recovery_point`.
8. **Sign off** in §6.

A **local proxy drill** (no cloud project) is available via `scripts/restore-drill.sh` — it restores
a `pg_dump` into a fresh local Supabase, applies migration parity, and runs reconciliation + pgTAP.
It exercises steps 3/5/6 and is a fast pre-check before a full cloud drill.

## 5. Failure modes → response

| Scenario | Response |
| --- | --- |
| Accidental bad migration / data corruption | PITR restore to just **before** the change; re-apply good migrations; reconcile. |
| Full project loss (provider) | Restore latest backup into a new project; repoint DNS/env; reconcile; smoke-test golden path. |
| Partial corruption (one tenant) | Restore to a scratch project, export the tenant's correct rows, reconcile, re-apply via **reversal/adjustment** entries (never mutate the ledger in place). |
| Suspected compromise | Follow [incident-response.md](incident-response.md): rotate all credentials **before** restoring, restore to a fresh project, do not reuse leaked keys. |

## 6. Recovery-drill evidence (fill in — required for DoD)

Record every drill. A drill older than the last major schema change should be re-run.

| Date | Operator | Scenario | Recovery point (T) | RTO measured | RPO measured | Reconciliation | pgTAP integrity | Sign-off |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _pending_ | | | | | | | | |

**ENGINEERING-12 is not "done" for DR until at least one row above is complete with all checks green.**
