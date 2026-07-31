import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/session';
import { getActiveOrg } from '@/lib/auth/org';
import { getPermissions } from '@/lib/auth/rbac';
import { AppNav } from '@/components/app-nav';

// Authenticated shell. Identity is validated server-side; unauthenticated users are
// redirected to /login (middleware also guards, this is defense-in-depth).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const org = await getActiveOrg();
  const permissions = await getPermissions();

  return (
    <div className="flex min-h-screen">
      <AppNav permissions={permissions} orgRole={org?.primary_role ?? null} />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
