import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/features/shared/empty-state';
import { ErrorState } from '@/components/features/shared/error-state';
import { InviteForm } from './invite-form';

// Onboarding-B — member list + invite. Server component: gates on user.invite and does
// the RLS-scoped roster read server-side (memberships_select_org requires user.invite);
// a user without the permission is redirected to /unauthorized before any query runs.
// The interactive invite form (which reveals the /join link on success) lives in the
// separate `<InviteForm />` client component. tr-TR.

const ROLE_LABEL: Record<string, string> = {
  employee: 'Çalışan',
  manager: 'Yönetici',
  hr: 'İK',
  finance: 'Finans',
  auditor: 'Denetçi',
  owner: 'Sahip',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Aktif',
  pending: 'Beklemede',
  deactivated: 'Pasif',
};

type MemberRow = {
  profile_id: string;
  primary_role: string;
  status: string;
  // The embedded relation can type as an array under PostgREST; narrow to a single row.
  profiles: { display_name: string } | { display_name: string }[] | null;
};

function displayNameOf(row: MemberRow): string | null {
  const p = row.profiles;
  if (!p) return null;
  return Array.isArray(p) ? (p[0]?.display_name ?? null) : p.display_name;
}

export default async function MembersPage() {
  if (!(await hasPermission('user.invite'))) redirect('/unauthorized');

  const org = await getActiveOrg();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('memberships')
    .select('profile_id, primary_role, status, profiles(display_name)')
    .eq('organization_id', org!.organization_id)
    .eq('status', 'active');

  const rows = (data ?? []) as MemberRow[];

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
          <CardTitle>Aktif üyeler</CardTitle>
          <CardDescription>Bu organizasyondaki aktif üyeler.</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorState message="Üyeler yüklenemedi." />
          ) : rows.length === 0 ? (
            <EmptyState message="Aktif üye yok" />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableCaption className="sr-only">Aktif üyeler listesi</TableCaption>
                <TableHeader>
                  <TableRow className="bg-muted/50 text-xs text-muted-foreground">
                    <TableHead>Ad</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Durum</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const name = displayNameOf(row);
                    return (
                      <TableRow key={row.profile_id}>
                        <TableCell>
                          {name ?? (
                            <span className="font-mono text-xs">{row.profile_id.slice(0, 8)}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {ROLE_LABEL[row.primary_role] ?? row.primary_role}
                        </TableCell>
                        <TableCell>{STATUS_LABEL[row.status] ?? row.status}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <InviteForm />
    </div>
  );
}
