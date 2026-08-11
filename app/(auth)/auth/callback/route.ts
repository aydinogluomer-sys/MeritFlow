import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/auth/org';

// Exchanges the auth code (magic link / OAuth) for a session cookie, then redirects.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const redirectParam = searchParams.get('redirectTo') ?? '/dashboard';
  // Only allow same-origin relative redirects (avoid open-redirect).
  const redirectTo = redirectParam.startsWith('/') ? redirectParam : '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // A user with no organization membership yet must complete onboarding first
      // (ignore any redirect param until they have an org).
      const org = await getActiveOrg();
      if (!org) {
        return NextResponse.redirect(`${origin}/onboarding`);
      }
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
