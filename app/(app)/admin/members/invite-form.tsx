'use client';

// Onboarding-B — invite form (client). Split out of the members page so the page can be
// a server component. Owns the interactive success state that reveals the /join link.
// MUST NOT import @/lib/supabase/admin (service_role stays server-only; boundary test).
// Authz is enforced server-side: inviteMember calls requirePermission('user.invite') and
// the create_invitation RPC re-checks it in the DB — this form is UX only. tr-TR.

import * as React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { inviteMember } from '@/app/actions/admin/invite-member';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState } from '@/components/features/shared/error-state';

const inputClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'employee', label: 'Çalışan' },
  { value: 'manager', label: 'Yönetici' },
  { value: 'hr', label: 'İK' },
  { value: 'finance', label: 'Finans' },
  { value: 'auditor', label: 'Denetçi' },
];

export function InviteForm() {
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('employee');
  const [isPending, startTransition] = React.useTransition();
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [joinLink, setJoinLink] = React.useState<string | null>(null);

  function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setInviteError(null);
    setJoinLink(null);
    startTransition(async () => {
      const result = await inviteMember({ email: email.trim(), role });
      if (!result.ok) {
        if (result.error === 'VALIDATION_ERROR') {
          setInviteError('Girdiğiniz bilgiler geçerli değil. Lütfen e-posta ve rolü kontrol edin.');
        } else {
          setInviteError('Davet oluşturulamadı. Lütfen tekrar deneyin.');
        }
        toast.error('Davet oluşturulamadı.');
        return;
      }
      setJoinLink(`${APP_URL}/join?token=${result.data.token}`);
      setEmail('');
      toast.success('Davet oluşturuldu.');
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Yeni üye davet et</CardTitle>
        <CardDescription>
          E-posta ve rol seçin. Sahip (owner) rolü ile davet edilemez.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleInvite} className="flex flex-col gap-4" aria-busy={isPending}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">E-posta</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isPending}
              placeholder="ornek@sirket.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Rol</Label>
            <Select value={role} onValueChange={setRole} disabled={isPending}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {inviteError ? <ErrorState message={inviteError} /> : null}

          <div>
            <Button type="submit" disabled={isPending || email.trim().length === 0}>
              {isPending ? 'Oluşturuluyor…' : 'Davet oluştur'}
            </Button>
          </div>
        </form>

        {joinLink ? (
          <div className="mt-5 flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-4">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-2 text-sm font-medium text-primary"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Davet oluşturuldu.
            </motion.div>
            <label htmlFor="join-link" className="text-sm font-medium">
              Davet bağlantısı
            </label>
            <input
              id="join-link"
              type="text"
              readOnly
              value={joinLink}
              onFocus={(e) => e.currentTarget.select()}
              className={`${inputClass} font-mono`}
            />
            <p className="text-xs text-muted-foreground">Bu bağlantıyı kişiyle paylaşın.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
