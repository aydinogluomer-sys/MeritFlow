import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/session';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { JoinForm } from './join-form';

// Onboarding-B — invite acceptance. Lives at the ROOT app/ (NOT the (app) or (onboarding)
// group) so the root layout is a bare HTML shell with no auth redirect and the ?token=
// survives. Server component: reads ?token= server-side (absent -> invalid-link card),
// verifies the session server-side (no user -> /login?redirectTo=…), then renders the
// interactive <JoinForm /> client component. The acceptInvitation action runs
// requireUser() and the RPC is SECURITY DEFINER + token-validated, so identity/authz are
// enforced on the server. No invite preview is shown: invitations RLS only exposes rows
// to user.invite holders, and the invitee is not yet a member. tr-TR.

export default async function JoinPage({
  searchParams,
}: {
  // Next 16 types searchParams as a Promise.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = typeof raw === 'string' ? raw : undefined;

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Geçersiz davet bağlantısı</CardTitle>
            <CardDescription>
              Bu bağlantı bir davet kodu içermiyor. Lütfen sizi davet eden kişiden geçerli bir
              bağlantı isteyin.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const user = await getUser();
  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/join?token=${token}`)}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <JoinForm token={token} />
    </main>
  );
}
