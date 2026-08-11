import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** Recursively collect every file under `dir`. Returns [] if `dir` does not exist. */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function tsFiles(dir: string): string[] {
  return walk(dir).filter((f) => /\.(ts|tsx)$/.test(f));
}

/** Path relative to repo root, with forward slashes — for readable failure messages. */
function rel(p: string): string {
  return p.slice(ROOT.length + 1).replace(/\\/g, '/');
}

const ACTIONS_DIR = join(SRC, 'app', 'actions');
const FEATURES_DIR = join(SRC, 'components', 'features');
const APP_DIR = join(ROOT, 'app', '(app)');

// Phase 8 Decision-Lock security/boundary invariants, asserted against the static source
// (no imports of `server-only` modules). Complements supabase-admin-boundary.test.ts:
// that file guards the service_role key/NEXT_PUBLIC surface; this file guards how the
// admin client and Finance views are actually used across actions and pages.
describe('security / boundary invariants (Phase 8 Decision-Lock)', () => {
  // ── Invariant 1: server actions enforce server-side authz (AD1) ──────────────
  //
  // Onboarding actions are a justified exception: they bootstrap a brand-new user who
  // has no membership yet, so requirePermission() would resolve against an empty
  // permission set and always deny. Instead they verify server-side identity via
  // requireUser() — see the AUTHZ comment in each onboarding action (AD1).
  it('every non-onboarding server action calls requirePermission( for server-side authz (AD1)', () => {
    const ONBOARDING_DIR = join(ACTIONS_DIR, 'onboarding');
    // settings/ actions use requireUser() (self-service identity, no role-gate needed — AD1).
    const SETTINGS_DIR = join(ACTIONS_DIR, 'settings');
    const files = tsFiles(ACTIONS_DIR).filter(
      (f) =>
        !f.startsWith(ONBOARDING_DIR + '\\') &&
        !f.startsWith(ONBOARDING_DIR + '/') &&
        !f.startsWith(SETTINGS_DIR + '\\') &&
        !f.startsWith(SETTINGS_DIR + '/'),
    );
    // Sanity: the non-onboarding action surface exists and was actually scanned.
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((f) => !readFileSync(f, 'utf8').includes('requirePermission('));

    expect(
      offenders.map(rel),
      `Server action(s) missing requirePermission( — client-side authz is not source of truth (AD1):\n${offenders
        .map(rel)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('every onboarding action calls requireUser( for server-side identity verification (AD1)', () => {
    const ONBOARDING_DIR = join(ACTIONS_DIR, 'onboarding');
    const files = tsFiles(ONBOARDING_DIR);
    // Sanity: the onboarding action surface exists and was actually scanned.
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((f) => !readFileSync(f, 'utf8').includes('requireUser('));

    expect(
      offenders.map(rel),
      `Onboarding action(s) missing requireUser( — server-side identity verification is required even for pre-org bootstrap (AD1):\n${offenders
        .map(rel)
        .join('\n')}`,
    ).toEqual([]);
  });

  // ── Invariant 2: admin client is used ONLY for .rpc(, never table/view reads ──
  // (rule 11 / Finance boundary — table/view reads must go through createClient so RLS
  //  is enforced; the service_role admin client bypasses RLS and is reserved for RPC.)
  it('admin client is never used for .from( reads — only .rpc( (Finance boundary / rule 11)', () => {
    const files = tsFiles(ACTIONS_DIR).filter((f) =>
      readFileSync(f, 'utf8').includes('createAdminClient'),
    );
    // At least one action uses the admin client for RPC; otherwise the heuristic is vacuous.
    expect(files.length).toBeGreaterThan(0);

    // The admin client variable is conventionally `admin`. `admin.from(` (any spacing) or
    // `createAdminClient().from(` would be a direct RLS-bypassing table/view read.
    const adminFrom = /\badmin\s*\.\s*from\s*\(/;
    const inlineFrom = /createAdminClient\s*\(\s*\)\s*\.\s*from\s*\(/;

    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return adminFrom.test(src) || inlineFrom.test(src);
    });

    expect(
      offenders.map(rel),
      `Admin (service_role) client used for a .from( read — RLS-bypassing table/view access is forbidden; route reads through createClient:\n${offenders
        .map(rel)
        .join('\n')}`,
    ).toEqual([]);
  });

  // ── Invariant 3: Finance views are read via createClient, never the admin client ──
  it('files touching v_finance_* never use the admin client, and readers use createClient (security_invoker)', () => {
    const financeView = /v_finance_(payout|period_totals)/;
    const adminCall = /createAdminClient\s*\(/;
    const financeRead = /\.\s*from\s*\(\s*['"]v_finance_/; // an actual read of a finance view
    const createClientCall = /\bcreateClient\b/;

    const candidates = [...tsFiles(APP_DIR), ...tsFiles(FEATURES_DIR)];
    const financeFiles = candidates.filter((f) => financeView.test(readFileSync(f, 'utf8')));

    // The payroll export detail page reads v_finance_payout — there must be ≥1 match, else
    // the invariant is silently testing nothing.
    expect(
      financeFiles.length,
      `Expected at least one Finance-view file under app/(app)/** or src/components/features/** (e.g. the payroll export detail page), found none.`,
    ).toBeGreaterThan(0);

    // 3a — NO Finance-view file may construct the RLS-bypassing admin client.
    const adminOffenders = financeFiles.filter((f) => adminCall.test(readFileSync(f, 'utf8')));
    expect(
      adminOffenders.map(rel),
      `Finance-view file uses createAdminClient() — the security_invoker Finance RLS session must be preserved via createClient:\n${adminOffenders
        .map(rel)
        .join('\n')}`,
    ).toEqual([]);

    // 3b — every file that actually READS a finance view (.from('v_finance_…')) must do so
    //      through createClient (comment-only references are exempt — they perform no read).
    const readers = financeFiles.filter((f) => financeRead.test(readFileSync(f, 'utf8')));
    expect(
      readers.length,
      `Expected at least one file that reads a Finance view via .from('v_finance_…') (the payroll export detail page).`,
    ).toBeGreaterThan(0);

    const readerOffenders = readers.filter((f) => !createClientCall.test(readFileSync(f, 'utf8')));
    expect(
      readerOffenders.map(rel),
      `File reads a Finance view but does not use createClient — RLS-scoped session is required:\n${readerOffenders
        .map(rel)
        .join('\n')}`,
    ).toEqual([]);
  });

  // ── Invariant 3b: settings actions use requireUser( for server-side identity (AD1) ──
  //
  // settings/ actions operate on the caller's own data with no role-gate;
  // requirePermission() would wrongly deny them. requireUser() verifies identity (AD1).
  it('self-service settings actions use requireUser( for server-side identity (AD1)', () => {
    const SETTINGS_DIR = join(ACTIONS_DIR, 'settings');
    const files = tsFiles(SETTINGS_DIR);
    // Sanity: the settings action surface exists and was actually scanned.
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((f) => !readFileSync(f, 'utf8').includes('requireUser('));

    expect(
      offenders.map(rel),
      `Settings action(s) missing requireUser( — server-side identity verification is required for self-service actions (AD1):\n${offenders
        .map(rel)
        .join('\n')}`,
    ).toEqual([]);
  });

  // ── Invariant 4: service-role key stays server-only (complementary angle) ─────
  // supabase-admin-boundary.test.ts already asserts admin.ts is `import 'server-only'`
  // and that no NEXT_PUBLIC_ alias leaks the key. Here we assert the *import graph* angle:
  // no client component ('use client') imports the admin module — importing it would drag
  // the service_role factory into a browser bundle (a build error, but caught here first).
  it('no client component (\'use client\') imports @/lib/supabase/admin', () => {
    const clientComponents = tsFiles(SRC)
      .concat(tsFiles(APP_DIR))
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        return /^\s*['"]use client['"]\s*;?/m.test(src);
      });

    const offenders = clientComponents.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /from\s+['"]@\/lib\/supabase\/admin['"]/.test(src) || src.includes('createAdminClient');
    });

    expect(
      offenders.map(rel),
      `Client component imports the service_role admin client — it would leak into the browser bundle:\n${offenders
        .map(rel)
        .join('\n')}`,
    ).toEqual([]);
  });
});
