'use client';

// Onboarding-B — invite acceptance. Lives at the ROOT app/ (NOT the (app) or
// (onboarding) group) so the root layout is a bare HTML shell with no auth redirect
// and the ?token= survives. Single-file client page (the accept form needs interactive
// state and the 7-file slice budget forbids a separate module).
//
// Flow: read ?token= (absent -> invalid-link message); verify the session client-side
// (no user -> redirect to /login?redirectTo=/join?token=…); else collect a display name
// and call acceptInvitation. The action runs requireUser() server-side and the RPC is
// SECURITY DEFINER + token-validated, so identity/authz are enforced on the server.
// No invite preview is shown: invitations RLS only exposes rows to user.invite holders
// in the org, and the invitee is not yet a member — so the invitee cannot read the row.
// tr-TR.

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { acceptInvitation } from '@/app/actions/onboarding/accept-invitation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ErrorState } from '@/components/features/shared/error-state';

const inputClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

export default function JoinPage() {
  // useSearchParams() forces client-side rendering, so the subtree must sit under a
  // Suspense boundary (Next.js prerender requirement).
  return (
    <React.Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        </main>
      }
    >
      <JoinContent />
    </React.Suspense>
  );
}

function JoinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [checkingAuth, setCheckingAuth] = React.useState(true);
  const [displayName, setDisplayName] = React.useState('');
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!token) {
      setCheckingAuth(false);
      return;
    }
    let active = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      if (!data.user) {
        const redirectTo = `/join?token=${token}`;
        router.replace(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
        return;
      }
      setCheckingAuth(false);
    })();
    return () => {
      active = false;
    };
  }, [token, router]);

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

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      </main>
    );
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitation({ token: token as string, displayName: displayName.trim() });
      if (result.ok) {
        router.push('/dashboard');
        return;
      }
      if (result.error === 'invitation_invalid') {
        setError('Bu davet süresi dolmuş veya kullanılmış.');
      } else if (result.error === 'already_member') {
        setError('Bu organizasyona zaten üyesiniz.');
      } else if (result.error === 'VALIDATION_ERROR') {
        setError('Girdiğiniz bilgiler geçerli değil. Lütfen adınızı kontrol edin.');
      } else {
        setError('Davet kabul edilemedi. Lütfen tekrar deneyin.');
      }
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Organizasyona katıl</CardTitle>
          <CardDescription>
            Davet edildiniz. Katılmak için görünen adınızı girin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-busy={isPending}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="join-display-name" className="text-sm font-medium">
                Adın
              </label>
              <input
                id="join-display-name"
                type="text"
                required
                minLength={1}
                maxLength={100}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={isPending}
                placeholder="Ad Soyad"
                className={inputClass}
              />
            </div>

            {error ? <ErrorState message={error} /> : null}

            <Button type="submit" disabled={isPending || displayName.trim().length === 0}>
              {isPending ? 'Katılınıyor…' : 'Katıl'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
