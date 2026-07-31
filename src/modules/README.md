# Domain modules (modular monolith)

Placeholder domain folders per `CLAUDE.md` (Architecture rules). **No domain logic lives
here yet** — each module is filled in when its phase is authorized (ADR-020). Keeping the
folders now locks the modular-monolith layout; services extraction is V2+.

Each domain will typically expose (in later phases): server actions, Zod schemas,
DB-access functions (via the RLS-enforced server client), and types.

Domains:

- `auth` — session, org context, RBAC read (Phase 3.5 helpers live in `src/lib/auth`).
- `organizations`, `users`, `teams` — tenant + identity + team management.
- `tasks`, `reviews` — Phase 4 (Task & Review Core).
- `scoring`, `point-ledger` — Phase 5 (scoring engine + approved→ledger).
- `bonus-periods`, `bonus-pools`, `bonus-calculation`, `bonus-ledger` — Phase 6 (bonus engine).
- `disputes`, `anti-gaming` — Phase 7.
- `audit` — audit surfacing.
- `notifications`, `exports` — delivery + export-generation engines (later).
- `reports`, `admin` — dashboards + admin.

The database foundation for these domains already exists under `supabase/migrations`
(`0001..0018`); this layer will call it through RLS.
