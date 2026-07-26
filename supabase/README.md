# MeritFlow — Supabase (Database Foundation: Phase 3A–3B + comp + bonus periods/pools + components/eligibility + calc runs/allocations/snapshots + ledger)

This directory is the **database foundation**. It currently implements eight verified
slices (each under its own `implementation authorized only for Phase 3X — …`):

- **Phase 3A — Database Foundation & RBAC** (`17_PHASE_3A_...md`): 11 foundation/RBAC
  tables, RLS helpers, RLS (ENABLED + FORCE), constraints, test-tenant seed, blocking pgTAP.
- **Phase 3B-A — Scoring Policy foundation** (`18_PHASE_3B_...md` §5.1/5.2): `scoring_policies`
  and `scoring_policy_versions` (immutable once published, AD7), `policy.manage`, RLS + pgTAP.
- **Phase 3B-B — Point Ledger foundation** (`18` §5.3/§7): append-only single-entry `point_ledger`,
  `team_of()` helper, server-only writes, RLS + pgTAP.
- **Phase 3 — compensation_records** (`14`/`15`, ADR-018): comp-sensitive salary / cap-basis source
  with **direct raw SELECT closed**, comp.read-gated INSERT/UPDATE, supersede-only retention
  (DELETE blocked), MASKED write/access audit, and an audited + justified
  `read_compensation_record(employee, reason)` — RLS + pgTAP.
- **Phase 3 — bonus_periods + bonus_pools** (`14`/`15`/`16` §3, AD10): period lifecycle state machine +
  pool (one active per period); **AD10 pool-lock-before-period-lock**; a locked pool requires
  `t_org` + `locked_at` + `locked_by` and its financial fields are immutable; locked/non-open period
  identity (dates/type/org) is immutable (SI-4); `period.manage` / `pool.create` separation — RLS + pgTAP.
- **Phase 3 — bonus_pool_components + bonus_pool_eligibility** (`14`/`15`/`16` §3, D1/D10/AD9/AD10): MVP
  **Safe Pro-Rata** component model (`individual` = 1.0 only) + eligibility rows; component/eligibility carry a
  **same-org composite FK** to `bonus_pools`; eligibility `employee_id` is a **same-org composite FK to
  `memberships`** (cross-tenant employees structurally impossible); `primary_team_id` is same-org + **AD9**
  `team_memberships.is_primary` validation; eligibility writes are **server-only** (employee-own + HR/Finance/
  Auditor read), component writes gated by `pool.create`; component and eligibility inputs become **immutable
  once the parent pool leaves `draft`** (SI-4) — RLS + pgTAP.
- **Phase 3 — bonus_calculation_runs + bonus_allocations + bonus_allocation_snapshots** (`14`/`15`/`16` §4–§5,
  D1/D6/AD6/AD7/AD9/AD10): the calculation **scaffolding** (no engine/math). Run state machine
  `running → completed → superseded`; a run starts only on a **locked period AND a locked pool** (AD10 double
  guard); **idempotency** `unique(organization_id, idempotency_key)`; once a run is `completed`, its allocations
  are **frozen** (blanket — amount/status/cap/team/policy/run bindings; SI-4/SI-14); a **thin** snapshot is
  **append-only immutable** (UPDATE/DELETE hard-blocked; per-employee detail lives in allocations, not
  duplicated); allocations carry a **cap-not-exceeded** CHECK + `cap_applied` enum (incl.
  `pending_missing_cap_basis` — AD6); `approved/exported/paid` transitions are **blocked** this slice;
  same-org composite FKs (period/pool/policy_version/run/employee/team); **server-only** writes with
  employee-own allocation read (Finance raw excluded — view-only, SI-12); `Σfinal + undistributed_remainder =
  pool` is **test/fixture-verified only** (no hard trigger — SI-13/INV-4) — RLS + pgTAP.
- **Phase 3 — bonus_ledger** (`06 §2`, `14`/`15`/`16`, ADR-017): append-only **double-entry** money ledger
  (`entry_type` debit/credit, `account` pool/accrual/payout/clawback); correction = reversal (UPDATE/DELETE
  hard-blocked — BL-1); a **DEFERRABLE INITIALLY DEFERRED balance trigger** hard-enforces
  `Σdebit = Σcredit` per `(organization_id, transaction_id)`; accrual requires `snapshot_id` (structural SI-3;
  approved-gate deferred to Phase 6); idempotent accrual `unique(snapshot_id, employee_id, account)`; only
  `bonus_accrual` + `reversal` are writable this slice (payout/clawback/approval events blocked by a guard);
  raw SELECT is **Finance + Auditor only** (HR/Employee/Manager/Support excluded — SI-12); **server-only**
  writes; same-org composite FKs (pool/run/snapshot/employee); INSERT audit (BL-4) — RLS + pgTAP.

Migrations `0001..0014` + seed apply cleanly; blocking pgTAP suites (`0001`..`0008`) are green (see
"Verification"). **Everything downstream is still gated** (see "Out of scope").

## ⚠️ Environment rule (non-negotiable — ADR-014 / CLAUDE.md)

- These migrations/seed run on **local dev / staging only**. **Never production.**
- Do **not** point the Supabase CLI/MCP at a production project.
- The `service_role` key is **env-only**: never committed, never shipped to the client.
  (Local `supabase start` prints the well-known **local dev default** keys — those are not secrets.)
- The seed (`seed/seed_test_tenants.sql`) creates **test** users/tenants only.

## Layout

```text
supabase/
  config.toml                             local dev/staging config
  migrations/
    0001_extensions_and_helpers.sql       pgcrypto, set_updated_at, prevent_mutation
    0002_core_tenant_identity.sql         organizations, organization_settings, profiles
    0003_rbac.sql                         roles, permissions, role_permissions, memberships
    0004_teams.sql                        teams, team_memberships
    0005_support_and_audit.sql            support_access_grants, audit_logs + audit triggers
    0006_rls_helpers.sql                  current_org/has_role/has_permission/manages_team/
                                          has_support_grant/shares_org (recursive-RLS safe, §7A)
    0007_rls_enable_and_policies.sql      RLS ENABLE+FORCE + policies (11 foundation tables)
    0008_scoring_policies.sql             scoring_policies + scoring_policy_versions (AD7 immutable
                                          published) + policy.manage RLS + audit  (Phase 3B-A)
    0009_point_ledger.sql                 point_ledger (append-only) + team_of() + server-only RLS +
                                          conditional audit  (Phase 3B-B)
    0010_compensation_records.sql         compensation_records (comp-sensitive) — raw SELECT closed;
                                          comp.read INSERT/UPDATE; DELETE blocked; mask_compensation +
                                          log_comp_audit (masked) + read_compensation_record (justified)
    0011_bonus_periods_pools.sql          bonus_periods + bonus_pools — state machine + AD10 pool-lock
                                          guard; locked pool needs t_org+locked_at+locked_by (immutable);
                                          period identity immutable (SI-4); period.manage/pool.create RLS
    0012_bonus_components_eligibility.sql bonus_pool_components (MVP individual=1.0 — D1) + bonus_pool_eligibility
                                          (same-org employee via memberships composite FK; AD9 is_primary; 15-day
                                          + proration — D10); server-only eligibility writes; inputs immutable
                                          once parent pool leaves draft (SI-4); pool.create component RLS
    0013_bonus_calc_runs_allocations_snapshots.sql bonus_calculation_runs + bonus_allocations +
                                          bonus_allocation_snapshots — run machine (running/completed/superseded)
                                          + AD10 locked-period+locked-pool guard; idempotency unique(org,key);
                                          completed-run allocation freeze (SI-4/SI-14); thin snapshot append-only;
                                          cap-not-exceeded + pending_missing_cap_basis; approved/exported/paid
                                          blocked; server-only writes (Finance raw excluded — SI-12)
    0014_bonus_ledger.sql                 bonus_ledger (append-only double-entry) — deferred Σdebit=Σcredit
                                          per (org, transaction_id) balance trigger; accrual⇒snapshot_id;
                                          idempotent accrual; only bonus_accrual+reversal writable; Finance/
                                          Auditor raw read only; server-only writes; INSERT audit (BL-4)
  seed/seed_test_tenants.sql              2 tenants, RBAC catalog, teams, support grants,
                                          + Phase 3B (scoring/versions, point_ledger) + comp + bonus fixtures
                                          (periods/pools + components/eligibility + calc run/allocations/snapshot
                                          + balanced accrual ledger)
  tests/
    0001_phase3a_rls.test.sql             blocking pgTAP — RLS/RBAC (Phase 3A)
    0002_phase3b_scoring_policies.test.sql blocking pgTAP — scoring policy/version (Phase 3B-A)
    0003_phase3b_point_ledger.test.sql    blocking pgTAP — point_ledger/append-only (Phase 3B-B)
    0004_phase3_compensation.test.sql     blocking pgTAP — compensation_records/masked audit (Phase 3)
    0005_phase3_bonus_periods_pools.test.sql blocking pgTAP — bonus periods/pools + AD10/SI-4 (Phase 3)
    0006_phase3_bonus_components_eligibility.test.sql blocking pgTAP — components/eligibility + D1/D10/AD9/SI-4 (Phase 3)
    0007_phase3_bonus_calc_runs_allocations_snapshots.test.sql blocking pgTAP — runs/allocations/snapshots + AD10/SI-4/SI-14 (Phase 3)
    0008_phase3_bonus_ledger.test.sql     blocking pgTAP — bonus_ledger double-entry/balance/append-only (Phase 3)
```

## Apply & test (local)

Requires Docker + the Supabase CLI. From the repo root:

```bash
supabase start            # boots local dev stack (Docker)
supabase db reset         # applies migrations 0001..0014 then seed
supabase test db          # runs the pgTAP suites in tests/ (0001..0008)
```

If the `supabase` binary is not on PATH (e.g. a fresh install not yet picked up), the project-local
CLI works too: `npx --no-install supabase <cmd>`.

`supabase db reset` is the canonical way to rebuild from scratch; the seed is written to be
re-runnable (on-conflict guards).

## Verification (local dev/staging only)

> **Phase 3A: VERIFIED / DONE** (2026-06-24). `db reset` (`0001..0007`) + `test db` → **38/38 passed**.
> Only change during verification: `throws_ok` 3-arg → strict 4-arg in `tests/0001`. No schema bug.
>
> **Phase 3B-A + 3B-B: VERIFIED / DONE** (2026-07-24, npx Supabase CLI **2.109.1**). `db reset`
> (`0001..0009`) + seed; `test db` → **Files=3, Tests=97, PASS, Failed=0**. Reproduced across two clean runs.
>
> **Phase 3 compensation_records: VERIFIED / DONE** (2026-07-24, npx Supabase CLI **2.109.1**;
> commit `c9cd0f2`). `db reset` (`0001..0010`) + seed; `test db` → **Files=4, Tests=139, PASS, Failed=0**.
> Security (AD3/D7/SI-5): **direct raw SELECT closed**, **raw reads require
> `read_compensation_record(employee, reason)`**, **write + access audits masked** (raw salary/cap never
> in `audit_logs`).
>
> **Phase 3 bonus_periods + bonus_pools: VERIFIED / DONE** (2026-07-24, npx Supabase CLI **2.109.1**;
> commit `d04b954`). `db reset` applied migrations **0001..0011** + seed cleanly; `test db` →
> **Files=5, Tests=194, Result=PASS, Failed=0** (`0001`..`0005` ok), reproduced across two clean runs.
> Invariants proven (AD10/SI-4): **a period cannot lock before its pool is locked**; a **locked pool
> requires `t_org` + `locked_at` + `locked_by`** and its amount/`t_org` are immutable (new version); a
> **locked/non-open period's identity (dates/type/org) is immutable**; `period.manage` (owner/hr) vs
> `pool.create` (finance) separation of duties; DELETE blocked. A non-fatal storage-container readiness
> warning during `db reset` is non-blocking (the green suite confirms schema + seed).
>
> **Phase 3 bonus_pool_components + bonus_pool_eligibility: VERIFIED / DONE** (2026-07-24, npx Supabase CLI
> **2.109.1**; commit `8f74e8d`). `db reset` applied migrations **0001..0012** + seed cleanly; `test db` →
> **Files=6, Tests=238, Result=PASS, Failed=0** (`0001`..`0006` ok), reproduced across two clean runs.
> Invariants proven (D1/D10/AD9/AD10/SI-4): MVP **Safe Pro-Rata** component (`individual` = 1.0 only);
> **cross-tenant employee eligibility is structurally impossible** (`(organization_id, employee_id)` composite
> FK to `memberships` → an out-of-org employee is rejected with `23503`); `primary_team_id` is same-org and
> must be the employee's `team_memberships.is_primary` (AD9); eligibility writes are **server-only**;
> **component and eligibility inputs cannot mutate once the parent pool leaves `draft`** (locked/superseded →
> `23001`); DELETE blocked. The storage-container readiness warning during `db reset` remains non-blocking.
>
> **Phase 3 bonus_calculation_runs + bonus_allocations + bonus_allocation_snapshots: VERIFIED / DONE**
> (2026-07-25, npx Supabase CLI **2.109.1**; commit `e3bd1a3`). `db reset` applied migrations **0001..0013** +
> seed cleanly; `test db` → **Files=7, Tests=299, Result=PASS, Failed=0** (`0001`..`0007` ok). Invariants proven
> (D1/D6/AD6/AD7/AD9/AD10/SI-4/SI-12/SI-13/SI-14): a run starts **only on a locked period AND a locked pool**
> (draft/superseded pool rejected with `23514`); state machine `running→completed→superseded`; **idempotency**
> `unique(organization_id, idempotency_key)` (`23505` on duplicate); once a run is `completed` its allocations
> are **frozen** (`23001` on any INSERT/UPDATE); the **thin snapshot is append-only** (UPDATE/DELETE → `23001`,
> one per run); `cap_applied='yes'` enforces `final_amount ≤ cap`; `approved/exported/paid` writes rejected
> (`23514`); cross-tenant runs/allocations rejected by composite FK (`23503`); `Σfinal + undistributed_remainder
> = pool` is asserted on the seed fixture (no hard trigger). One transient `db reset` "container exit 1" flake
> (vector/analytics/pg_meta unhealthy) cleared on a `--debug` reset — not a code/schema defect.
>
> **Phase 3 bonus_ledger: VERIFIED / DONE** (2026-07-26, npx Supabase CLI **2.109.1**; commit `71e68f7`).
> `db reset` applied migrations **0001..0014** + seed cleanly; `test db` → **Files=8, Tests=328, Result=PASS,
> Failed=0** (`0001`..`0008` ok). Invariants proven (ADR-017/BL-1..4/SI-3/SI-12): **double-entry** — a
> **DEFERRABLE INITIALLY DEFERRED** balance trigger rejects any `(organization_id, transaction_id)` where
> `Σdebit ≠ Σcredit` (`23514`, forced in tests via `set constraints all immediate`); **append-only** (UPDATE/
> DELETE → `23001`, correction = reversal); accrual requires `snapshot_id` (`23514`) and is idempotent per
> `(snapshot, employee, account)` (`23505`); only `bonus_accrual` + `reversal` are writable — payout/clawback/
> approval events rejected (`23514`); raw SELECT is **Finance + Auditor only** (HR/Employee/Manager/Support all
> read 0 rows); cross-tenant ledger rows rejected by composite FK (`23503`). The deferred balance trigger fires
> at commit, so the balanced seed accrual (debit pool = Σ credit accruals) applies cleanly. A transient
> `db reset` container flake (`ENOTFOUND` / "exit 1") cleared on retry — not a code/schema defect.
>
> **Later phases remain gated** (ADR-020). **Never run any of this against a production project.**

### Prerequisites

- [ ] **Docker Desktop** installed and **running** — verify: `docker info`.
- [ ] **Supabase CLI** available — `supabase --version` **or** `npx --no-install supabase --version`.
  - Install (Windows, no repo impact): **winget** `winget install Supabase.CLI`, **or** **Scoop**
    `scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase`.
  - Or project-local via `npx supabase` (the CLI is **not** supported as a global npm install).
  - macOS: `brew install supabase/tap/supabase`.
- [ ] You are in the repo root, and **not** linked to production (no `supabase link`/`db push`/`db pull`).

### Steps

```bash
supabase start        # 1. boot local stack; note the printed local URLs + dev-default keys
supabase db reset     # 2. apply 0001..0014 + seed (expect clean apply)
supabase test db      # 3. run pgTAP; expect TAP summary 0 failed
```

### Expected pass criteria

- [ ] **All pgTAP assertions pass** (TAP: `0` failed; currently **Files=8, Tests=328, PASS**). Blocking.
- [ ] Green coverage: cross-tenant isolation (SI-7), non-recursive memberships read (§7A), support
  active-vs-expired grant (D4), append-only audit + append-only `point_ledger` (SI-2), helper
  correctness, scoring-policy `policy.manage` gating + published-version immutability (AD7), point_ledger
  visibility (Finance excluded), **compensation_records** (raw SELECT closed, masked audit, justified read),
  **bonus_periods/pools** (state machine, AD10 pool-lock, locked t_org + immutability, period identity
  immutability, period.manage/pool.create separation — SI-4/SI-7), **bonus_pool_components/eligibility**
  (MVP individual=1.0 — D1; cross-tenant employee rejected via memberships composite FK; AD9 is_primary;
  server-only eligibility writes; inputs immutable once parent pool leaves draft — SI-4), and
  **bonus_calculation_runs/allocations/snapshots** (run machine + AD10 locked-period+locked-pool guard;
  idempotency; completed-run allocation freeze; thin snapshot append-only; cap-not-exceeded;
  approved/exported/paid blocked; Finance raw-allocation excluded — SI-12/SI-14), and **bonus_ledger**
  (double-entry deferred `Σdebit=Σcredit` per (org, transaction_id); append-only; accrual⇒snapshot + idempotent;
  only bonus_accrual+reversal writable; Finance/Auditor-only raw read — HR/Employee/Manager/Support excluded).
- [ ] `supabase db reset` then re-running the suite is reproducible (deterministic seed).

### Failure triage

- **Stale/dead stack** (`supabase_db_...` shows `Exited (137)`) → not a code defect; `supabase stop
  --no-backup` then `supabase start`, then `db reset`.
- **Migration fails on `auth.users` insert** → watchpoint A (extend seed's `auth.users` columns).
- **`supabase test db` errors "function ... does not exist" / pgTAP missing** → watchpoint B.
- **Assertions about counts fail as authenticated** → watchpoint C (role switching / `request.jwt.claims`).
- **Helpers return null/false unexpectedly under RLS** → watchpoint D (owner role BYPASSRLS assumption).
- **Cross-tenant test "leaks" rows** → a policy is missing its `organization_id = current_org()` anchor
  (a real defect). After any fix, re-run `supabase db reset && supabase test db` from a clean state.

### Version-dependent watchpoints

- **A. `auth.users` seed columns** — extend the seed's `auth.users` INSERT if a local Supabase auth
  schema requires more NOT NULL columns. (Seed/migration files: do not change without re-authorization.)
- **B. pgTAP availability** — use the Supabase test runner (`supabase test db`).
- **C. role switching** — suites use `set local role authenticated` + `set_config('request.jwt.claims', …)`.
- **D. BYPASSRLS owner-role** — recursive-RLS safety (§7A) relies on SECURITY DEFINER helpers owned by a
  bypassrls role (Supabase `postgres`).

### ⛔ Production safety

- Local stack only. Do **not** `supabase link` + `db push`/`db pull` to prod, and do **not** point
  Supabase MCP at production (ADR-014 / CLAUDE.md). `service_role` key stays in env.

## Tables and data classes

**Phase 3A — foundation/RBAC (11):**

| Table | org_id? | Class | Notes |
| --- | :--: | --- | --- |
| organizations | no (root) | internal | tenant root |
| organization_settings | yes | confidential | 1-1, audited |
| profiles | **no (global)** | personal-data | auth-bound; org link via memberships (§8A) |
| roles / permissions / role_permissions | **no (catalog)** | internal/confidential | global, read-only to clients (§8A) |
| memberships | yes (anchor) | confidential | one primary_role/org (AD2); audited |
| teams | yes | internal | manager_id drives manages_team |
| team_memberships | yes | internal | is_primary = single eval team (AD9) |
| support_access_grants | yes | audit-critical | time-bounded (D4); audited |
| audit_logs | yes | audit-critical | append-only; comp payload masked (AD3) |

**Phase 3B / Phase 3 comp + bonus (12):**

| Table | org_id? | Class | Notes |
| --- | :--: | --- | --- |
| scoring_policies | yes | confidential | writes need `policy.manage`; audited |
| scoring_policy_versions | yes | confidential, audit-critical | **immutable once published** (AD7); same-org composite FK |
| point_ledger | yes | audit-critical, financial-critical | **append-only**; server-only writes; Finance excluded |
| compensation_records | yes | **compensation-sensitive**, personal-data | **no direct raw SELECT**; comp.read INSERT/UPDATE; DELETE blocked; masked write/access audit; raw reads via `read_compensation_record()` |
| bonus_periods | yes | financial-critical | state machine (open→locked→…→closed); locked needs metadata; identity immutable once locked (SI-4); org-wide read, `period.manage` write; DELETE blocked |
| bonus_pools | yes | financial-critical | one active pool/period; **AD10** period-lock guard; locked needs `t_org`+metadata + immutable; HR/Finance/Auditor read, `pool.create` write; DELETE blocked |
| bonus_pool_components | yes | financial-critical | MVP `individual`=1.0 only (D1); same-org composite FK to pool; HR/Finance/Auditor read, `pool.create` write; **immutable once pool leaves draft** (SI-4); DELETE blocked |
| bonus_pool_eligibility | yes | financial-critical, personal-data | 15-day + proration (D10); **same-org employee via `memberships` composite FK**; `primary_team_id` same-org + AD9 `is_primary`; **server-only writes**; employee-own + HR/Finance/Auditor read; **immutable once pool leaves draft** (SI-4); DELETE blocked |
| bonus_calculation_runs | yes | financial-critical, audit-critical | run machine running/completed/superseded; starts only on **locked period + locked pool** (AD10); idempotency `unique(org, key)`; **server-only writes**; HR/Finance/Auditor read; audited; DELETE blocked |
| bonus_allocations | yes | financial-critical | per (run, employee); cap-not-exceeded + `cap_applied` (pending_missing_cap_basis); same-org employee/team composite FK + AD9; **frozen once run completed** (SI-4/SI-14); **server-only writes**; employee-own + HR/Auditor read (**Finance view-only — SI-12**); DELETE blocked |
| bonus_allocation_snapshots | yes | financial-critical, audit-critical | **thin** freeze marker, one per run; **append-only immutable** (UPDATE/DELETE blocked — INV-6/SI-14); same-org composite FK; **server-only** insert; HR/Finance/Auditor read; audited |
| bonus_ledger | yes | financial-critical, audit-critical | **double-entry** (debit/credit; pool/accrual/payout/clawback); **append-only** (correction=reversal); **deferred `Σdebit=Σcredit` per (org, transaction_id)** trigger; accrual⇒snapshot + idempotent; only bonus_accrual+reversal writable; **server-only writes**; **raw read Finance+Auditor only** (HR/Employee/Manager/Support excluded — SI-12); audited (BL-4) |

## Security guarantees enforced here

- **RLS ENABLED + FORCE** on all tenant tables (SI-6); every tenant policy anchored on
  `organization_id = current_org()` → cross-tenant blocked (SI-7).
- **Authorization from DB** (`role_permissions`), never JWT (AD1); JWT = identity only.
- **Recursive-RLS safe** (§7A): helpers (incl. `team_of`) are SECURITY DEFINER + fixed `search_path`.
- **Least privilege**: `authenticated` is never granted `DELETE`; catalog tables read-only; `point_ledger`
  is SELECT-only for `authenticated`; **`compensation_records` has NO raw SELECT** (only column `id`;
  raw reads via the audited `read_compensation_record()`); `bonus_pools` read limited to HR/Finance/Auditor.
- **Append-only** (SI-2): triggers block UPDATE/DELETE on `audit_logs` and `point_ledger`.
- **Scoring-version immutability** (AD7): published `scoring_policy_versions` cannot be UPDATE/DELETE'd.
- **Compensation confidentiality** (AD3/D7/SI-5): raw salary/cap never directly selectable and never in
  `audit_logs` (masked write + access audit); raw reads require a reason and are audited; DELETE forbidden.
- **Bonus lock discipline** (AD10/SI-4): a period cannot lock before its pool is locked; a locked pool
  requires `t_org` + lock metadata and freezes its amount/`t_org`; a locked/non-open period's dates/type/org
  are immutable; `period.manage` vs `pool.create` separation of duties.
- **Bonus calc-input integrity** (D1/D10/AD9/SI-4): `bonus_pool_eligibility.employee_id` is a **same-org
  composite FK to `memberships`** → a cross-tenant employee cannot be made eligible; `primary_team_id` is
  same-org and must be the employee's `team_memberships.is_primary` (AD9); components are limited to MVP
  `individual`=1.0 (D1); eligibility writes are **server-only**; once the parent pool leaves `draft`, both
  components and eligibility rows are **immutable** (locked/superseded calc inputs cannot silently change).
- **Bonus calculation integrity** (AD6/AD10/SI-4/SI-12/SI-13/SI-14): a `bonus_calculation_run` starts **only on
  a locked period AND a locked pool** (draft/superseded pool rejected); runs are idempotent per
  `(organization_id, idempotency_key)`; once a run is `completed`, its `bonus_allocations` are **fully frozen**
  (any INSERT/UPDATE rejected); `bonus_allocation_snapshots` are **thin + append-only** (UPDATE/DELETE blocked,
  one per run); allocations enforce `final_amount ≤ cap` when capped and carry the `pending_missing_cap_basis`
  marker (AD6); `approved/exported/paid` transitions are blocked in this slice; all run/allocation/snapshot
  child links are **same-org composite FKs** (cross-tenant impossible); allocation reads exclude Finance (raw
  is view-only, SI-12); `Σfinal + undistributed_remainder = pool` is verified by test/fixture, not a hard
  trigger (SI-13/INV-4).
- **Double-entry money integrity** (ADR-017/BL-1..4/SI-3/SI-12): `bonus_ledger` is **append-only** (UPDATE/
  DELETE hard-blocked; correction = reversal); a **DEFERRABLE INITIALLY DEFERRED** balance trigger rejects any
  `(organization_id, transaction_id)` where `Σdebit ≠ Σcredit`; accrual requires `snapshot_id` and is
  idempotent per `(snapshot_id, employee_id, account)`; only `bonus_accrual` + `reversal` are writable in this
  slice; raw read is **Finance + Auditor only** (HR/Employee/Manager **and support-grant** all excluded);
  writes are **server-only**; all child links are same-org composite FKs. BL-2/BL-3 are test/fixture-verified.
- **Support access** (D4): default no access; read only via an **active, unexpired** grant; audited. Support is
  **not** a raw-read path on the money ledger (`bonus_ledger` is Finance/Auditor only).

## Out of scope (later slices / phases — still gated, ADR-020)

Scoring **engine** (final_points math + approve→ledger + `task_approved`/`task_id`), tasks & task_reviews,
the **approve→accrual posting engine** + snapshot-approval workflow, payout/export (`payout_exported`/
`payout_marked_paid`, exports) + Finance aggregate views (`v_finance_*`), clawback workflow, dispute→reversal
wiring, disputes, anti_gaming_flags, notifications, projects, objectives, integrations, webhook_events,
UI/dashboard, API routes. Each needs its own phase-scoped, verbatim authorization (ADR-020).

> **Next recommended slice:** **disputes + dispute_events foundation** — the dispute lifecycle state machine
> (`open → under_review → needs_info → resolved → closed` — doc 16 §6 / D9), `dispute_type` / `target_type` /
> `target_id`, SLA `due_at` (opened + 5 business days), the **resolver ≠ owner of the disputed decision** guard
> (a manager cannot be final on their own decision — D9), an append-only `dispute_events` history, and RLS
> (complainant + assigned reviewer + HR + Auditor). The recalculation/ledger wiring (accepted → point_ledger
> adjustment / new calc run) is engine work and stays out. **Not authorized yet.**

## Notes for reviewers

- `auth.users` seeding uses a minimal column set; extend the seed's `auth.users` INSERT if a local
  Supabase version requires additional NOT NULL auth columns.
- Primary team is resolved **only** from `team_memberships.is_primary` (AD9); `memberships` has no
  `primary_team_id` and must not gain one.
- Comp direct-SELECT access-auditing for HR/Finance is intentionally closed at the DB (no raw SELECT
  path); the audited path is `read_compensation_record()` (OQ-RLS-2 resolved for this table).
- bonus_periods overlap prevention is `unique(org, starts_on, ends_on)` + `ends_on > starts_on`; full
  daterange overlap exclusion (btree_gist) is deferred to a later slice.
