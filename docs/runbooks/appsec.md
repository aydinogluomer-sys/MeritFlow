# AppSec Runbook (ENGINEERING-08)

How MeritFlow's application-security guardrails are enforced in CI, the standing threat model,
and the two rollouts that are deliberately staged (dependency-audit blocking, CSP enforcement).

> Reminder: never point any scanner or fix at the production database. Supabase MCP is
> staging/dev only (CLAUDE.md). The service-role key lives only in env — never committed, never
> logged (SI-11 / AD1).

## 1. CI security gates

| Gate | Workflow | Blocking? | What it catches |
| --- | --- | --- | --- |
| **Secret scan** | `security.yml` → `secret-scan` (gitleaks) | **Yes** | Any secret committed to the tree. Allowlist: CI dummies + `.env.example` + `supabase/seed/*` (`.gitleaks.toml`). |
| **SAST** | `codeql.yml` (CodeQL, `security-extended`) | Alerts (Security tab) | Injection, unsafe flows, taint issues in JS/TS. |
| **Dependency audit** | `security.yml` → `dependency-audit` (`npm audit`) | **No** (staged — §3) | Known advisories in npm deps (high+). |
| **Secure headers** | `tests/unit/security-headers.test.ts` + `next.config.ts` | **Yes** (unit) | Regression that drops HSTS / frame / no-surveillance headers. |
| **Dependabot** | `.github/dependabot.yml` | n/a (PRs) | Routine + security version bumps (npm + github-actions). |
| **Service-role boundary** | `supabase-admin-boundary.test.ts`, `security-boundary.test.ts`, ESLint `no-restricted-imports` | **Yes** (unit + lint) | Service-role client imported in client code / exposed via `NEXT_PUBLIC_` (SI-11). Modules inject the admin client; never value-import it. |

## 2. Threat model (STRIDE-lite → prevention / detection / regression-test)

| Vector | Prevention | Detection | Regression test |
| --- | --- | --- | --- |
| **Secret leakage** (service-role key, tokens) | env-only secrets; admin client injected, never imported; `NEXT_PUBLIC_` alias forbidden for the service key | gitleaks (blocking); `captureServerError` scrubs JWT/secret/email (04) | `supabase-admin-boundary.test.ts`, `security-headers.test.ts`, `scrub.test.ts` |
| **Cross-tenant access** | RLS `organization_id = current_org()` on every table; org derived from `getActiveOrg()` (server), never the payload | RLS FORCE; cross-tenant pgTAP | `isolation/org-scoping.test.ts` (06), cross-tenant pgTAP (0015/0016) |
| **Privilege escalation** | server-side `requirePermission` (authz-first) + RLS as ultimate guard; JWT claims are not the source of truth | typed `FORBIDDEN`/`RLS_DENIED` (03); authz-first tests | `concurrency-contracts.test.ts` T-B7/T-B8 (06) |
| **Invitation abuse** | `create_invitation` is SECURITY DEFINER, validates `user.invite` + role ≠ owner + active org; token is single-use | audit row per invitation; RLS on reads | admin/invitation pgTAP + `admin.test.ts` |
| **Support-access abuse** (D4) | time-bounded, scoped grants; `has_support_grant` gate; NO support path on the money ledger (Finance/Auditor only) | 0005 triggers audit grant/revoke; comp-access audit (AD3) | `admin.test.ts` (grant/revoke), `0025_comp_access_audit` pgTAP |
| **Clickjacking / mixed content** | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`; HSTS | header unit test | `security-headers.test.ts` |
| **Surveillance surface** (CLAUDE.md: no monitoring) | `Permissions-Policy: camera=(), microphone=(), geolocation=()` | header unit test | `security-headers.test.ts` |
| **Vulnerable dependency** | Dependabot bumps; `npm audit` gate (staged) | `npm audit` (report), CodeQL, Dependabot alerts | dependency-audit job |
| **Raw error / schema disclosure** | typed `DomainError` codes only cross the boundary (03) | no raw PG message returned | `validation-action.test.ts`, `translate.test.ts` |
| **Brute force / rate abuse** | Supabase Auth throttling (auth endpoints) | — | **GAP — see §4** |

## 3. Dependency-audit rollout (staged → blocking)

`npm audit --audit-level=high` currently reports **10 advisories (6 high, 1 critical)**, mostly in
dev/transitive tooling (build/test chain). Blocking the pipeline on this pre-existing debt would
wedge every push, so `dependency-audit` is **non-blocking** (`continue-on-error`) today.

To flip it to blocking:

1. `npm audit` → trioage each advisory: runtime vs dev-only, direct vs transitive.
2. `npm audit fix` for non-breaking; for breaking, bump the direct dependency deliberately (its own PR).
3. For accepted/unfixable transitive advisories, record an explicit exception here with a rationale + review date.
4. When `npm audit --audit-level=high` exits clean, remove `continue-on-error` from `dependency-audit`
   and add it to the branch-protection required checks.

## 4. CSP rollout (Report-Only → Enforcing)

`next.config.ts` ships `Content-Security-Policy-**Report-Only**` — it declares the policy without
enforcing it, so it cannot break the app before there is a golden-path E2E (ENGINEERING-11) to
validate an enforcing policy. The current policy still allows `'unsafe-inline'`/`'unsafe-eval'`
(placeholders).

To enforce:

1. Land golden-path E2E (11); add a report endpoint (`report-to`) and collect violations from real flows.
2. Replace `'unsafe-inline'`/`'unsafe-eval'` with nonces/hashes (Next supports a nonce via middleware).
3. Flip the header key `Content-Security-Policy-Report-Only` → `Content-Security-Policy`; keep the
   unit test asserting the enforcing key is present.

## 5. Known gaps (tracked, not yet closed)

- **Application-level rate limiting** on sensitive mutations (invitation, support-access grant,
  dispute/export) beyond Supabase Auth's built-in throttling — candidate for a dedicated slice
  (Upstash Redis token bucket per the V1 stack note).
- **SBOM generation** (e.g. CycloneDX) — not yet emitted; add to `security.yml` when needed for
  supply-chain provenance.
- **Secret rotation runbook** for the service-role / DB credentials — operational, pairs with
  ENGINEERING-12 (production proof / rotation drill).
