'use client';

// Onboarding-B — member list + invite. Single-file client page (invite form needs
// interactive success state to reveal the /join link, and the 7-file slice budget
// forbids splitting the form into its own module). Access is enforced server-side:
// the members read is RLS-scoped (memberships_select_org requires user.invite), and
// the inviteMember action calls requirePermission('user.invite') + create_invitation
// re-checks it in the DB. A user without user.invite simply sees an empty roster and
// cannot mint invitations. tr-TR.

import * as React from 'react';
import { createClient } from '@/lib/supabase/client';
import { inviteMember } from '@/app/actions/admin/invite-member';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/features/shared/empty-state';
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

const ROLE_LABEL = new Map(ROLE_OPTIONS.map((r) => [r.value, r.label]));

const STATUS_LABEL: Record<string, string> = {
  active: 'Aktif',
  pending: 'Beklemede',
  deactivated: 'Pasif',
};

type MemberRow = {
  profile_id: string;
  primary_role: string;
  status: string;
  profiles: { display_name: string } | null;
};

export default function MembersPage() {
  const [rows, setRows] = React.useState<MemberRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);

  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('employee');
  const [isPending, startTransition] = React.useTransition();
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [joinLink, setJoinLink] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('memberships')
        .select('profile_id, primary_role, status, profiles(display_name)')
        .eq('status', 'active');
      if (!active) return;
      if (error) {
        setLoadError(true);
      } else {
        setRows((data ?? []) as unknown as MemberRow[]);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

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
        return;
      }
      setJoinLink(`${APP_URL}/join?token=${result.data.token}`);
      setEmail('');
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Üyeler</h1>
        <p className="text-sm text-muted-foreground">
          Organizasyon üyelerini görüntüleyin ve yeni üye davet edin. Davet e-postası MVP&apos;de
          gönderilmez; oluşturulan bağlantıyı kişiyle siz paylaşırsınız.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Yeni üye davet et</CardTitle>
          <CardDescription>E-posta ve rol seçin. Sahip (owner) rolü ile davet edilemez.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="flex flex-col gap-4" aria-busy={isPending}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="invite-email" className="text-sm font-medium">
                E-posta
              </label>
              <input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isPending}
                placeholder="ornek@sirket.com"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="invite-role" className="text-sm font-medium">
                Rol
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={isPending}
                className={inputClass}
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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

      <Card>
        <CardHeader>
          <CardTitle>Aktif üyeler</CardTitle>
          <CardDescription>Bu organizasyondaki aktif üyeler.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : loadError ? (
            <ErrorState message="Üyeler yüklenemedi." />
          ) : rows.length === 0 ? (
            <EmptyState message="Aktif üye yok" />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Aktif üyeler listesi</caption>
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">
                      Ad
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Rol
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Durum
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.profile_id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        {row.profiles?.display_name ?? (
                          <span className="font-mono text-xs">{row.profile_id.slice(0, 8)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{ROLE_LABEL.get(row.primary_role) ?? row.primary_role}</td>
                      <td className="px-4 py-3">{STATUS_LABEL[row.status] ?? row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
