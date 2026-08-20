import { test as setup } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// ENGINEERING-11 — Playwright auth setup. The app login is magic-link OTP (no password
// form), so we cannot authenticate through the UI. Instead we sign in the SEEDED test users
// (supabase/seed/seed_test_tenants.sql — password `password123`, email pre-confirmed) with a
// password grant and persist the session as Playwright `storageState`.
//
// Why the @supabase/ssr client (not plain supabase-js): the Next server reads the session
// from COOKIES, not localStorage. A plain supabase-js sign-in writes localStorage, which the
// server never sees. We drive the REAL @supabase/ssr server client with a capturing
// cookie-jar adapter — on the SIGNED_IN event it flushes the auth-token cookie(s) (correct
// name, base64url encoding, chunking) into our jar via setAll. We then serialize the jar into
// a storageState file. This is encoding-agnostic and version-proof: the cookie NAME both this
// setup and the app derive from the same NEXT_PUBLIC_SUPABASE_URL, so they always match.

const AUTH_DIR = path.join(process.cwd(), 'tests', 'e2e', '.auth');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// The Next dev server (and thus the auth cookies) is served from 127.0.0.1.
const APP_HOST = '127.0.0.1';
// Matches @supabase/ssr DEFAULT_COOKIE_OPTIONS.maxAge (400 days).
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

async function signInAndSaveState(
  email: string,
  password: string,
  outFile: string,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'auth.setup: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from env.',
    );
  }

  // Capturing cookie jar. The @supabase/ssr client flushes auth cookies here on SIGNED_IN.
  const jar = new Map<string, string>();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet: { name: string; value: string }[]) {
        for (const cookie of cookiesToSet) {
          jar.set(cookie.name, cookie.value);
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`auth.setup: sign-in failed for ${email}: ${error.message}`);
  }

  // The cookie flush runs in the async onAuthStateChange(SIGNED_IN) handler — wait for it.
  const deadline = Date.now() + 5000;
  const hasToken = () => [...jar.keys()].some((k) => k.includes('auth-token'));
  while (!hasToken() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!hasToken()) {
    throw new Error(`auth.setup: no auth-token cookie was produced for ${email}.`);
  }

  const expires = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_S;
  const storageState = {
    cookies: [...jar.entries()].map(([name, value]) => ({
      name,
      value,
      domain: APP_HOST,
      path: '/',
      expires,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    })),
    origins: [],
  };

  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(outFile, JSON.stringify(storageState, null, 2));
}

setup('authenticate as HR', async () => {
  await signInAndSaveState('hr-a@acme.test', 'password123', path.join(AUTH_DIR, 'hr-user.json'));
});

setup('authenticate as employee', async () => {
  await signInAndSaveState(
    'emp-alpha-a@acme.test',
    'password123',
    path.join(AUTH_DIR, 'emp-user.json'),
  );
});

// ENGINEERING-17 — golden-path fixtures: manager (task.review), finance (payout.export/mark_paid),
// and an Org-B employee (cross-tenant IDOR negative).
setup('authenticate as manager', async () => {
  await signInAndSaveState(
    'mgr-alpha-a@acme.test',
    'password123',
    path.join(AUTH_DIR, 'mgr-user.json'),
  );
});

setup('authenticate as finance', async () => {
  await signInAndSaveState(
    'finance-a@acme.test',
    'password123',
    path.join(AUTH_DIR, 'finance-user.json'),
  );
});

setup('authenticate as org-b employee', async () => {
  await signInAndSaveState('emp-b@globex.test', 'password123', path.join(AUTH_DIR, 'emp-b-user.json'));
});
