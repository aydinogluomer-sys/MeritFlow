import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/session';
import { getActiveOrg } from '@/lib/auth/org';
import { getPermissions } from '@/lib/auth/rbac';
import { createClient } from '@/lib/supabase/server';
import { FeatureFlagResolver } from '@/modules/intelligence';
import { AppNav } from '@/components/app-nav';
import { CommandPalette } from '@/components/command-palette';
import { ErrorBoundary } from '@/components/error-boundary';

// Authenticated shell. Identity is validated server-side; unauthenticated users are
// redirected to /login (middleware also guards, this is defense-in-depth).
// ENGINEERING-26: getUser() now throws on auth service errors (fail-closed). Catching here
// and redirecting to /login is the correct behavior: if we cannot verify identity, treat
// as unauthenticated rather than showing an error page at the protected URL.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await getUser();
  } catch {
    redirect('/login');
  }
  if (!user) redirect('/login');

  const org = await getActiveOrg();
  // A user with no organization membership yet must complete onboarding first.
  if (!org) redirect('/onboarding');
  const permissions = await getPermissions();

  // Profile/org metadata for the sidebar profile block (Phase-UI-2, 2D/2E). Read through
  // the RLS-scoped server client (NOT the admin client) so the user JWT is preserved and
  // ownership/tenant policies are enforced — the nav is a client component and receives
  // this only via props (it must never import server-only modules).
  const supabase = await createClient();
  const [{ data: profile }, { data: orgRow }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    supabase
      .from('organizations')
      .select('slug')
      .eq('id', org.organization_id)
      .maybeSingle(),
  ]);

  const displayName = profile?.display_name ?? user.email ?? 'Kullanıcı';

  // Feature-flag-gated nav items (§21). Resolve the flags used by the nav (Policy Change Impact
  // and Policy Debt surfaces) so each entry is hidden when the org has that flag off.
  const flagResolver = new FeatureFlagResolver(supabase, org.organization_id);
  const [impactOn, debtOn] = await Promise.all([
    flagResolver.isEnabled('policy_change_impact'),
    flagResolver.isEnabled('policy_debt'),
  ]);
  const featureFlags = [
    ...(impactOn ? ['policy_change_impact'] : []),
    ...(debtOn ? ['policy_debt'] : []),
  ];

  return (
    <div className="flex min-h-screen">
      <AppNav
        permissions={permissions}
        orgRole={org?.primary_role ?? null}
        displayName={displayName}
        email={user.email ?? ''}
        orgSlug={orgRow?.slug ?? null}
        featureFlags={featureFlags}
      />
      {/* Global Cmd/Ctrl+K palette. `permissions` is the DB-derived set (AD1); the palette
          only navigates to routes the user is already entitled to (Phase-UI-6, 6A). */}
      <CommandPalette permissions={permissions} />
      <main className="flex-1 p-6">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
