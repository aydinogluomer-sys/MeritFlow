# Environments & Deployment Runbook (ENGINEERING-12)

The environment ladder, secret isolation, and how a change reaches production safely. Application
hosting is Vercel; the database is Supabase (managed Postgres). Migrations are the **only** way
schema reaches any environment.

> **Never touch the production database directly** (CLAUDE.md / ADR-014). Production schema changes
> go through committed migrations + `supabase db push` via the gated [deploy workflow](../../.github/workflows/deploy.yml).

## 1. Environment ladder

| Env | App | Database | Purpose |
| --- | --- | --- | --- |
| **local** | `next dev` | local Supabase (`supabase start`) | development; `supabase db reset` applies all migrations + seed |
| **preview** | Vercel PR preview | staging Supabase (or a branch) | per-PR review; never points at prod |
| **staging** | Vercel (staging) | dedicated staging Supabase project | pre-prod parity; where drills + smoke tests run |
| **production** | Vercel (production) | dedicated production Supabase project | live tenants |

**Parity rule:** every environment has the **same migrations** applied, in the same order. Only
secrets and scale differ. A change proven on staging with prod-parity schema is the only thing that
ships to prod.

## 2. Secret isolation

- **Per environment**: local / staging / production each have their **own** Supabase project, keys,
  DB password, and (when enabled) Sentry DSN. A staging key can never read prod data.
- **`SUPABASE_SERVICE_ROLE_KEY`** is server-only (SI-11): set only in the server runtime env (Vercel
  server env + GitHub Actions secrets), never `NEXT_PUBLIC_`, never logged, never in the client bundle.
  Enforced by `src/lib/env.ts` (`serverEnv()` throws if a `NEXT_PUBLIC_` alias appears).
- **`NEXT_PUBLIC_*`** (URL + anon key) are the only browser-exposed values; they are RLS-protected.
- Deploy-pipeline secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`)
  live in **GitHub Actions secrets**, scoped to the `production` environment (see §4).
- See [.env.example](../../.env.example) for the app runtime variables.

## 3. App deployment (Vercel)

- `main` is the release branch. Vercel builds + deploys the app on merge to `main`.
- Build uses per-env `NEXT_PUBLIC_*`; the production build inlines the production Supabase URL/anon key.
- **Rollback:** Vercel keeps previous deployments — an app-only regression is rolled back instantly
  by promoting the previous deployment (no code change needed). This is the first mitigation in
  [incident-response.md](incident-response.md).

## 4. Database deployment (gated migration release)

Schema changes never auto-apply to prod. They ship through the manual, environment-gated
[`deploy` workflow](../../.github/workflows/deploy.yml):

1. Migrations merged to `main` are already green on CI (`migration-lint` + drift + pgTAP `0031`).
2. An operator dispatches the `deploy` workflow (`workflow_dispatch`). It **always** runs
   `supabase db push --dry-run` first and prints the exact DDL.
3. The real `supabase db push` runs only when dispatched with `apply=true` **and** after the GitHub
   `production` environment's **required reviewers** approve (configure this in repo settings).
4. Follow the production checklist in [migration-safety.md](migration-safety.md) §5 (heavy-DDL
   timeouts, `CONCURRENTLY`, backup verified, expand–contract for breaking changes, rollback plan).

**Setup required (one-time, operator):** add the `production` environment in GitHub repo settings with
required reviewers, and add the secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`,
`SUPABASE_DB_PASSWORD` scoped to it.

## 5. Post-deploy smoke tests

After any prod deploy:

- `GET /api/health` → `{ status: 'ok', db: 'up' }`.
- Golden-path E2E against **staging** (org → task → approval → points → bonus → snapshot → payroll)
  before promoting; production smoke is read-only (health + a signed-in dashboard load).
- Reconciliation run (ENGINEERING-05) clean.

## 6. Rollback / roll-forward

- **App:** Vercel instant rollback to the previous deployment.
- **Database:** migrations are **roll-forward** — a bad migration is corrected by a *new* migration,
  never a manual `DROP`/undo. Destructive changes use expand–contract (three migrations) so each step
  is independently reversible-by-re-expand. A data-corruption event uses PITR restore
  ([disaster-recovery.md](disaster-recovery.md)), not a schema rollback.

## 7. Deployment audit trail

- Git history + tags/releases on `main` are the code record.
- The `deploy` workflow run (who dispatched, dry-run output, approval) is the DB-change record —
  retain the run logs.
- In-app config/policy/period changes are captured in `audit_logs` (append-only) per the audit rules.

## 8. Feature flags / kill-switch (documented — not app code this slice)

A kill-switch lets you disable a surface without a redeploy. Per Decision Lock, a flag can **never**
be a source of business/financial truth (no flag gates a ledger or a calculation result).

- **This slice ships the policy, not the code.** Recommended mechanism when implemented: an env-var
  read at the edge/middleware (e.g. `MAINTENANCE_MODE`) that serves a maintenance page, plus a
  server-read flag for *non-financial* feature gating.
- Implementing an app-read flag module is a **future slice** (kept out here intentionally to avoid a
  half-wired switch that looks like a control but isn't).
