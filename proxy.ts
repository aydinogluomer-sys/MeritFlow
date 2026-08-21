import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Next.js 16 "proxy" convention (formerly middleware.ts). Refreshes the Supabase
// session cookie each request and guards the (app)-group routes.
const PROTECTED_PREFIXES = ['/dashboard'];

// ENGINEERING-19 (8.3): strict, per-request Content-Security-Policy. A fresh nonce keys script-src;
// 'strict-dynamic' cascades that nonce to scripts loaded by trusted scripts; 'unsafe-eval' is
// dev-only (Next HMR requires it). NO 'unsafe-inline' in script-src. Styles keep 'unsafe-inline'
// (per-request style nonces are impractical with Tailwind/next-themes). Exported for the unit test.
export const buildCsp = (nonce: string): string =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${
      process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : ''
    }`,
    "connect-src 'self' https:",
    'report-uri /api/csp-report',
  ].join('; ');

export async function proxy(request: NextRequest) {
  // Per-request nonce, forwarded to server components via the x-nonce request header. `btoa`
  // (not Buffer) so this works in the Edge runtime where the proxy runs.
  const nonce = btoa(crypto.randomUUID());
  request.headers.set('x-nonce', nonce);

  // Carry the mutated request headers forward so RSC can read x-nonce via headers().
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set({ name, value, ...options }),
          );
        },
      },
    },
  );

  // Validates identity server-side (never trusts client claims).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectTo', path);
    return NextResponse.redirect(url);
  }

  // Enforcing per-request CSP on the final response.
  response.headers.set('Content-Security-Policy', buildCsp(nonce));
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
