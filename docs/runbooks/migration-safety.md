# Migration Safety Runbook (ENGINEERING-07)

How MeritFlow keeps schema migrations from silently losing data, deadlocking production, or
drifting from the committed migrations. MeritFlow ships to `main` with CI as the gatekeeper; the
gates below are enforced automatically, but production DDL still needs the human checklist in §5.

> **Never touch the production database directly.** Supabase MCP is staging/dev only (CLAUDE.md).
> Production changes go through committed migrations + `supabase db push` in the deploy pipeline.

## 1. Migration file standard

- **Naming:** `NNNN_snake_case.sql` — exactly four digits, lower-snake description, `.sql`.
  Numbers are **contiguous from 0001, no gaps and no duplicates** (`check-migrations.sh` Control 1–2).
- **One responsibility per migration.** A migration does one coherent change; document its intent
  and rollback strategy in a header comment (see any existing `0013_*`/`0014_*` for the house style).
- **Determinism:** functions use `set search_path = ''` and fully-qualified `public.` names; helpers
  that must bypass RLS are `security definer`. Add `set statement_timeout` / `set lock_timeout`
  only when a statement can take a heavy lock (see §3) — otherwise leave defaults.
- **No destructive DDL** (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `RENAME COLUMN`) except as the
  final, deliberate **contract** step of an expand–contract (see §2). CI blocks these (Control 3).
  Function-internal temp/scratch tables (`_bce_tmp`, leading-underscore) are exempt.

## 2. Expand–Contract pattern (mandatory for breaking changes)

A breaking column/table change is split across **three separate migrations**, deployed in order —
never in one step:

1. **EXPAND** — add the new shape alongside the old (both work). e.g. add the new column NULLABLE,
   add a new table, add a trigger that dual-writes. Non-destructive; passes `check-migrations.sh`.
2. **MIGRATE** — application code switches to the new shape; backfill existing rows in batches.
   No schema change here beyond data movement.
3. **CONTRACT** — remove the old shape (`DROP COLUMN` / `DROP TABLE`). This is the destructive step;
   it is only safe once nothing reads the old shape. `check-migrations.sh` flags destructive DDL, so
   a contract migration is a **deliberate, reviewed exception** (a future `_contract_` filename
   convention can whitelist it; until then, review explicitly).

The three phases **cannot** be applied out of order — they are three commits/migrations, gated by CI
each time.

## 3. Deadlock-risk DDL — production rules

| Operation | Safe form |
| --- | --- |
| `ADD COLUMN NOT NULL` | Add **NULLABLE** (or with a constant `DEFAULT`), **backfill** in batches, then add a `NOT NULL` constraint via `CHECK` → validate. Never `ADD COLUMN NOT NULL` without a default on a large table (full rewrite + `ACCESS EXCLUSIVE` lock). |
| `CREATE INDEX` | **Always `CONCURRENTLY`** on live prod, preceded by `SET statement_timeout = '0'; SET lock_timeout = '2s';`. A plain `CREATE INDEX` takes a `SHARE` lock that blocks writes. (`check-migrations.sh` Control 4/5 warn on non-concurrent / no-timeout.) |
| `SET NOT NULL` | Add a `CHECK (col IS NOT NULL) NOT VALID`, `VALIDATE CONSTRAINT` (no full lock), then `SET NOT NULL` (PostgreSQL 12+ uses the validated constraint and skips the scan). |
| `DROP COLUMN` / `DROP TABLE` | Only as the **contract** step of §2, after confirming nothing reads it. Prefer soft-deprecation first. |
| `ALTER TYPE` / enum change | Add new enum values (`ADD VALUE`, cannot run in a transaction block on old PG); never reorder/remove values in place. |

**Fresh-reset CI vs. live prod:** CI runs `supabase db reset` (empty DB → all migrations), so a plain
`CREATE INDEX` is harmless there. `CONCURRENTLY` + timeouts matter for **live** `supabase db push`.
That is why Control 4/5 are **warnings**, not hard failures — they are guidance for prod DDL.

## 4. CI gates (enforced automatically)

- **`migration-lint` job** — `scripts/check-migrations.sh`: naming + contiguous ordering +
  destructive-op detection (hard fail) + index-safety (warn). Runs in parallel with lint/typecheck/unit;
  no Docker.
- **`db` job → Schema drift check** — after `supabase db reset`, `supabase db diff` must be empty. A
  non-empty diff means the live schema has changes not captured in a migration file → **fail**.
- **`db` job → pgTAP** — `supabase/tests/0031_migration_integrity.test.sql`: populated-upgrade proxy
  (seed survives the full stack + critical financial columns still present + RLS still enabled on the
  point/bonus ledgers), alongside the full pgTAP suite.

## 5. Production deployment checklist

Before deploying a migration to production:

- [ ] `supabase db push --dry-run` output reviewed — the exact DDL is what you expect.
- [ ] Heavy DDL wrapped with `SET statement_timeout = '0'; SET lock_timeout = '2s';` (per §3), and
      indexes use `CONCURRENTLY`.
- [ ] Backup taken / verified (Supabase point-in-time restore enabled, or a fresh `pg_dump`).
- [ ] Any breaking change is planned as **three** expand–contract migrations (§2), each its own PR.
- [ ] `migration-lint`, drift-check, and pgTAP `0031` are green on the PR.
- [ ] Rollback / roll-forward plan written (contract steps are not auto-reversible — plan a
      re-expand migration, not a manual `DROP` undo).
