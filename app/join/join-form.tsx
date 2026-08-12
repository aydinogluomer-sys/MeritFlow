'use client';

// Onboarding-B — join form (client). Split out of the join page so the page can be a
// server component (which reads ?token= and verifies the session server-side). Owns the
// interactive display-name input + acceptInvitation call. MUST NOT import the admin
// client. acceptInvitation runs requireUser() server-side and the RPC is SECURITY DEFINER
// + token-validated, so identity/authz are enforced on the server. tr-TR.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { acceptInvitation } from '@/app/actions/onboarding/accept-invitation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorState } from '@/components/features/shared/error-state';

export function JoinForm({ token }: { token: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = React.useState('');
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitation({ token, displayName: displayName.trim() });
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
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Organizasyona katıl</CardTitle>
        <CardDescription>Davet edildiniz. Katılmak için görünen adınızı girin.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-busy={isPending}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="join-display-name">Adın</Label>
            <Input
              id="join-display-name"
              type="text"
              required
              minLength={1}
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={isPending}
              placeholder="Ad Soyad"
            />
          </div>

          {error ? <ErrorState message={error} /> : null}

          <Button type="submit" disabled={isPending || displayName.trim().length === 0}>
            {isPending ? 'Katılınıyor…' : 'Katıl'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
