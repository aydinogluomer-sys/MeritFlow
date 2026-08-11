import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/session';

// Onboarding shell — no AppNav (the user has no org yet). Identity is validated
// server-side; unauthenticated users go to /login. Just a centered card wrapper.
export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect('/login');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
