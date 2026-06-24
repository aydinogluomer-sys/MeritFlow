# MeritFlow — Supabase (Phase 3A: Database Foundation & RBAC)

This directory is the **database foundation** delivered under
`implementation authorized only for Phase 3A — Database Foundation & RBAC`.
It implements **only** Phase 3A scope (see `docs/planning/17_PHASE_3A_...md`):
11 foundation/RBAC tables, RLS helpers, RLS (ENABLED + FORCE), constraints, a
test-tenant seed, and a blocking pgTAP suite. Nothing downstream (tasks, scoring,
point/bonus ledgers, compensation, disputes, anti-gaming, notifications, exports,
UI, API) is implemented here.

## ⚠️ Environment rule (non-negotiable — ADR-014 / CLAUDE.md)

- These migrations/seed run on **local dev / staging only**. **Never production.**
- Do **not** point the Supabase CLI/MCP at a production project.
- The `service_role` key is **env-only**: never committed, never shipped to the client.
- The seed (`seed/seed_test_tenants.sql`) creates **test** users/tenants only.

## Layout

```
supabase/
  config.toml                         local dev/staging config
  migrations/
    0001_extensions_and_helpers.sql   pgcrypto, set_updated_at, prevent_mutation
    0002_core_tenant_identity.sql     organizations, organization_settings, profiles
    0003_rbac.sql                     roles, permissions, role_permissions, memberships
    0004_teams.sql                    teams, team_memberships
    0005_support_and_audit.sql        support_access_grants, audit_logs + audit triggers
    0006_rls_helpers.sql              current_org/has_role/has_permission/manages_team/
                                      has_support_grant/shares_org (recursive-RLS safe, §7A)
    0007_rls_enable_and_policies.sql  RLS ENABLE+FORCE + policies (all 11 tables)
  seed/seed_test_tenants.sql          2 tenants, RBAC catalog, teams, support grants
  tests/0001_phase3a_rls.test.sql     blocking pgTAP RLS/RBAC suite
```

## Apply & test (local)

Requires Docker + the Supabase CLI (`supabase`). From the repo root:

```bash
supabase start            # boots local dev stack (Docker)
supabase db reset         # applies migrations 0001..0007 then seed
supabase test db          # runs the pgTAP suite in tests/
```

`supabase db reset` is the canonical way to rebuild from scratch; the seed is
written to be re-runnable (on-conflict guards).

## Phase 3A verification checklist (local dev/staging only)

> **Phase 3A: VERIFIED / DONE** (2026-06-24, local dev stack). Evidence: `supabase db reset`
> passed (migrations `0001..0007` + seed applied), `supabase test db` passed — **38/38 pgTAP
> tests passed (0 failed)**. The only code/test change during verification was
> `supabase/tests/0001_phase3a_rls.test.sql` (fixing the pgTAP `throws_ok` assertion form from
> 3-arg to strict 4-arg `(sql, errcode, errmsg, description)`); **no migration/seed/RLS/schema bug
> was found**. The steps below reproduce this verification on any local stack.
> **Phase 3B+ remains gated** and requires explicit, verbatim authorization (ADR-020).
> **Never run any of this against a production project.**

### 0. Prerequisites

- [ ] **Docker Desktop** installed and **running** — verify: `docker info` (must succeed).
- [ ] **Supabase CLI** installed — verify: `supabase --version`.
  - Install: `npm i -g supabase` *or* `scoop install supabase` (Win) / `brew install supabase/tap/supabase` (mac).
- [ ] You are in the repo root (the folder containing `supabase/`).
- [ ] You are **not** linked to a production project: `supabase projects list` should not be
  the target; do **not** run `supabase db push`/`link` against prod. Local only.

### 1. Boot the local stack

```bash
supabase start
```

- [ ] Stack boots; note the printed local API URL + `service_role` key (env-only — never commit/ship to client).

### 2. Apply migrations + seed

```bash
supabase db reset
```

- [ ] Migrations `0001..0007` apply cleanly, then `seed/seed_test_tenants.sql` runs.
- [ ] No error about `auth.users` columns, missing extension, or FK ordering.

### 3. Run the blocking test suite

```bash
supabase test db
```

- [ ] `tests/0001_phase3a_rls.test.sql` runs under pgTAP.

### Expected pass criteria

- [ ] **All pgTAP assertions pass** (TAP summary: `0` failed). This suite is **blocking** —
  Phase 3A is not "done" until it is green.
- [ ] Specifically green: cross-tenant isolation (SI-7), non-recursive memberships read (§7A),
  support active-vs-expired grant (D4), append-only audit UPDATE/DELETE blocked (SI-2),
  helper correctness (current_org/has_role/has_permission/manages_team), §8A catalog read-only +
  profiles same-org visibility, and the constraint negatives (AD2/AD9 uniqueness, expiry check).
- [ ] `supabase db reset` then re-running the suite is reproducible (deterministic seed UUIDs).
- [ ] (Recommended) check advisors for residual RLS/security warnings via the Supabase MCP
  `get_advisors` against the **local/staging** project only.

### Failure triage

- **Migration fails on `auth.users` insert** → see watchpoint A (extend the seed's `auth.users` columns).
- **`supabase test db` errors "function ... does not exist" / pgTAP missing** → watchpoint B.
- **Assertions about counts fail as authenticated** (e.g. role/permission counts, helper results) →
  watchpoint C (role switching / `auth.uid()` claims) — confirm `request.jwt.claims` is honored.
- **Helpers return null/false unexpectedly under RLS** (e.g. `current_org()` empty) → watchpoint D
  (owner role BYPASSRLS assumption); confirm SECURITY DEFINER functions bypass RLS.
- **Cross-tenant test "leaks" rows** → a policy is missing its `organization_id = current_org()`
  anchor; re-check `0007` for that table (this would be a real defect, not an env issue).
- After any fix, re-run `supabase db reset && supabase test db` from a clean state.

### Version-dependent watchpoints

- **A. `auth.users` seed columns** — the seed inserts a minimal column set
  (`instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,*_token,email_change`).
  If the local Supabase auth schema requires additional NOT NULL columns, extend the seed's
  `auth.users` INSERT. (Seed/migration files: do not change without re-authorization — flag instead.)
- **B. pgTAP availability** — `supabase test db` provides pgTAP; if a custom Postgres lacks it, the
  suite cannot run. Use the Supabase-provided test runner.
- **C. role switching / `pg_prove` behavior** — the suite uses `set local role authenticated` +
  `set_config('request.jwt.claims', …)` so `auth.uid()` resolves. If your harness suppresses or
  mis-parses non-TAP output from setup statements, adjust runner flags; the assertions themselves
  are standard pgTAP.
- **D. BYPASSRLS owner-role assumption** — recursive-RLS safety (§7A) relies on SECURITY DEFINER
  helpers being owned by a role that bypasses RLS (Supabase `postgres`). If a non-standard setup
  owns them differently, either grant BYPASSRLS to a dedicated helper-owner role or confirm the
  non-recursive `memberships` base policy still resolves self-rows.

### ⛔ Production safety

- These commands target the **local** stack only. Do **not** `supabase link` + `supabase db push`
  to production, and do **not** point Supabase MCP at a production project (ADR-014 / CLAUDE.md).
- `service_role` key stays in env; never commit it, never include it in any client bundle.

## Tables (11) and data classes

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
| audit_logs | yes | audit-critical | append-only (UPDATE/DELETE blocked) |

## Security guarantees enforced here

- **RLS ENABLED + FORCE** on all 11 tables (SI-6); every tenant policy anchored on
  `organization_id = current_org()` → cross-tenant blocked (SI-7).
- **Authorization from DB** (`role_permissions`), never JWT (AD1); JWT = identity only.
- **Recursive-RLS safe** (§7A): helpers are SECURITY DEFINER (owner = bypassrls
  migration role) + fixed `search_path`, and `memberships` has a **non-recursive base
  SELECT policy** (`profile_id = auth.uid()`).
- **§8A exceptions**: `organizations` (root), `profiles` (global), `roles`/`permissions`/
  `role_permissions` (catalog) carry **no** `organization_id`; policies written accordingly.
- **Least privilege**: `authenticated` is never granted `DELETE`; catalog tables are
  read-only to clients; `service_role` is the trusted writer (bypassrls).
- **Append-only audit** (SI-2): a trigger blocks UPDATE/DELETE on `audit_logs` even for
  bypassrls roles. Sensitive RBAC/tenant mutations auto-write audit rows.
- **Support access** (D4): default no access; read only via an **active, unexpired** grant;
  grant + access are auditable.

## Out of scope (later slices / phases — still gated)

tasks, task_reviews, scoring engine, point_ledger, bonus_* , bonus_ledger,
compensation_records, disputes, anti_gaming_flags, notifications, exports, projects,
objectives, integrations, webhook_events, UI/dashboard, API routes. Each needs its own
phase-scoped authorization (ADR-020).

## Notes for reviewers

- `auth.users` seeding uses a minimal column set; if a local Supabase version requires
  additional NOT NULL auth columns, extend the seed's `auth.users` INSERT accordingly.
- Open implementation questions tracked in plan §16 / docs 13–16 (e.g., OQ-RLS-2 comp
  audit mechanism) belong to later slices, not Phase 3A.
