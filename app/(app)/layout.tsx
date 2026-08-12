import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/session';
import { getActiveOrg } from '@/lib/auth/org';
import { getPermissions } from '@/lib/auth/rbac';
import { createClient } from '@/lib/supabase/server';
import { AppNav } from '@/components/app-nav';
import { CommandPalette } from '@/components/command-palette';

// Authenticated shell. Identity is validated server-side; unauthenticated users are
// redirected to /login (middleware also guards, this is defense-in-depth).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
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

  return (
    <div className="flex min-h-screen">
      <AppNav
        permissions={permissions}
        orgRole={org?.primary_role ?? null}
        displayName={displayName}
        email={user.email ?? ''}
        orgSlug={orgRow?.slug ?? null}
      />
      {/* Global Cmd/Ctrl+K palette. `permissions` is the DB-derived set (AD1); the palette
          only navigates to routes the user is already entitled to (Phase-UI-6, 6A). */}
      <CommandPalette permissions={permissions} />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
