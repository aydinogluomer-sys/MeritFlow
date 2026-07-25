# MeritFlow — Supabase (Database Foundation: Phase 3A–3B + compensation_records)

This directory is the **database foundation**. It currently implements four verified
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

Migrations `0001..0010` + seed apply cleanly; blocking pgTAP suites (`0001`/`0002`/`0003`/`0004`) are
green (see "Verification"). **Everything downstream is still gated** (see "Out of scope").

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
  seed/seed_test_tenants.sql              2 tenants, RBAC catalog, teams, support grants,
                                          + Phase 3B (scoring/versions, point_ledger) + Phase 3 comp fixtures
  tests/
    0001_phase3a_rls.test.sql             blocking pgTAP — RLS/RBAC (Phase 3A)
    0002_phase3b_scoring_policies.test.sql blocking pgTAP — scoring policy/version (Phase 3B-A)
    0003_phase3b_point_ledger.test.sql    blocking pgTAP — point_ledger/append-only (Phase 3B-B)
    0004_phase3_compensation.test.sql     blocking pgTAP — compensation_records/masked audit (Phase 3)
```

## Apply & test (local)

Requires Docker + the Supabase CLI. From the repo root:

```bash
supabase start            # boots local dev stack (Docker)
supabase db reset         # applies migrations 0001..0010 then seed
supabase test db          # runs the pgTAP suites in tests/ (0001..0004)
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
> commit `c9cd0f2`). `db reset` applied migrations **0001..0010** + seed cleanly; `test db` →
> **Files=4, Tests=139, Result=PASS, Failed=0** (`0001` ok · `0002` ok · `0003` ok · `0004` ok).
> Security properties proven (AD3/D7/SI-5): **direct raw SELECT is closed** (no SELECT policy; salary
> columns not selectable), **raw reads require `read_compensation_record(employee, reason)`** (comp.read/
> auditor + non-empty reason), and **write + access audits are masked** (raw salary/cap never lands in
> `audit_logs`). A non-fatal storage-container readiness warning during `db reset` is non-blocking
> (the green suite confirms schema + seed).
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
supabase db reset     # 2. apply 0001..0010 + seed (expect clean apply)
supabase test db      # 3. run pgTAP; expect TAP summary 0 failed
```

### Expected pass criteria

- [ ] **All pgTAP assertions pass** (TAP: `0` failed; currently **Files=4, Tests=139, PASS**). Blocking.
- [ ] Green coverage: cross-tenant isolation (SI-7), non-recursive memberships read (§7A), support
  active-vs-expired grant (D4), append-only audit + append-only `point_ledger` (SI-2), helper
  correctness, scoring-policy `policy.manage` gating + published-version immutability (AD7), point_ledger
  visibility (Finance excluded), and **compensation_records** (raw SELECT closed, comp.read writes,
  DELETE blocked, masked write/access audit, justified `read_compensation_record`, cross-tenant — SI-5/SI-7).
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

**Phase 3B-A / 3B-B / Phase 3 comp (4):**

| Table | org_id? | Class | Notes |
| --- | :--: | --- | --- |
| scoring_policies | yes | confidential | writes need `policy.manage`; audited |
| scoring_policy_versions | yes | confidential, audit-critical | **immutable once published** (AD7); same-org composite FK |
| point_ledger | yes | audit-critical, financial-critical | **append-only**; server-only writes; Finance excluded |
| compensation_records | yes | **compensation-sensitive**, personal-data | **no direct raw SELECT**; comp.read INSERT/UPDATE; DELETE blocked; masked write/access audit; raw reads via `read_compensation_record()` |

## Security guarantees enforced here

- **RLS ENABLED + FORCE** on all tenant tables (SI-6); every tenant policy anchored on
  `organization_id = current_org()` → cross-tenant blocked (SI-7).
- **Authorization from DB** (`role_permissions`), never JWT (AD1); JWT = identity only.
- **Recursive-RLS safe** (§7A): helpers (incl. `team_of`) are SECURITY DEFINER + fixed `search_path`.
- **Least privilege**: `authenticated` is never granted `DELETE`; catalog tables read-only; `point_ledger`
  is SELECT-only for `authenticated`; **`compensation_records` has NO raw SELECT** (only column `id`;
  raw reads via the audited `read_compensation_record()`).
- **Append-only** (SI-2): triggers block UPDATE/DELETE on `audit_logs` and `point_ledger`.
- **Scoring-version immutability** (AD7): published `scoring_policy_versions` cannot be UPDATE/DELETE'd.
- **Compensation confidentiality** (AD3/D7/SI-5): raw salary/cap never directly selectable and never in
  `audit_logs` (masked write + access audit); raw reads require a reason and are audited; DELETE forbidden
  (supersede-only retention).
- **Support access** (D4): default no access; read only via an **active, unexpired** grant; audited.

## Out of scope (later slices / phases — still gated, ADR-020)

Scoring **engine** (final_points math + approve→ledger + `task_approved`/`task_id`), tasks & task_reviews,
bonus_* / bonus_ledger / snapshots, disputes, anti_gaming_flags, notifications, exports, projects,
objectives, integrations, webhook_events, Finance aggregate views (`v_finance_*`), UI/dashboard, API
routes. Each needs its own phase-scoped, verbatim authorization (ADR-020).

> **Next recommended slice:** **bonus foundation** (`bonus_periods` / `bonus_pools` /
> `bonus_pool_components` / `bonus_pool_eligibility` / `bonus_calculation_runs` / `bonus_allocations` /
> `bonus_allocation_snapshots` / `bonus_ledger`) — pool-lock (AD10), snapshot factors (AD7),
> `pending_missing_cap_basis` (AD6, consuming compensation_records). **Not authorized yet.**

## Notes for reviewers

- `auth.users` seeding uses a minimal column set; extend the seed's `auth.users` INSERT if a local
  Supabase version requires additional NOT NULL auth columns.
- Primary team is resolved **only** from `team_memberships.is_primary` (AD9); `memberships` has no
  `primary_team_id` and must not gain one.
- Comp direct-SELECT access-auditing for HR/Finance is intentionally closed at the DB (no raw SELECT
  path); the audited path is `read_compensation_record()` (OQ-RLS-2 resolved for this table).
