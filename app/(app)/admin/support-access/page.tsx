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
import { EmptyState } from '@/components/features/shared/empty-state';
import { ErrorState } from '@/components/features/shared/error-state';
import { GrantSupportForm } from '@/components/features/admin/grant-support-form';
import { RevokeSupportButton } from '@/components/features/admin/revoke-support-button';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

type GrantRow = {
  id: string;
  grantee_id: string;
  scope: string;
  expires_at: string;
  granted_by: string;
  reason: string | null;
};

export default async function SupportAccessPage() {
  if (!(await hasPermission('support.grant'))) redirect('/unauthorized');

  const supabase = await createClient();
  const org = await getActiveOrg();

  const { data, error } = await supabase
    .from('support_access_grants')
    .select('id, grantee_id, scope, expires_at, granted_by, reason')
    .eq('organization_id', org!.organization_id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at');

  const rows = (data ?? []) as GrantRow[];

  // Resolve grantee/granter display names (profiles is RLS-scoped identity).
  const profileIds = [
    ...new Set(
      rows.flatMap((r) => [r.grantee_id, r.granted_by]).filter((v): v is string => typeof v === 'string'),
    ),
  ];
  const nameById = new Map<string, string>();
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', profileIds);
    for (const p of (profiles ?? []) as Array<{ id: string; display_name: string }>) {
      nameById.set(p.id, p.display_name);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Destek erişimi</h1>
        <p className="text-sm text-muted-foreground">
          Zaman sınırlı, kapsamı belirli destek erişimi (D4). Varsayılan = erişim yok. Her
          verme ve her iptal denetim kaydı üretir.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Yeni erişim ver</CardTitle>
          <CardDescription>
            Erişim verilecek kişiyi, kapsamı, gerekçeyi ve bitiş zamanını girin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GrantSupportForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aktif erişimler</CardTitle>
          <CardDescription>Süresi dolmamış aktif erişimler (en erken biten önce).</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorState message="Destek erişimleri yüklenemedi." />
          ) : rows.length === 0 ? (
            <EmptyState message="Aktif destek erişimi yok" />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Aktif destek erişimleri listesi</caption>
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">
                      Erişim verilen
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Kapsam
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Bitiş
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Veren
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      <span className="sr-only">İşlem</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        {nameById.get(row.grantee_id) ?? (
                          <span className="font-mono text-xs">{row.grantee_id.slice(0, 8)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{row.scope}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {dateFormatter.format(new Date(row.expires_at))}
                      </td>
                      <td className="px-4 py-3">
                        {nameById.get(row.granted_by) ?? (
                          <span className="font-mono text-xs">{row.granted_by.slice(0, 8)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RevokeSupportButton grantId={row.id} />
                      </td>
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
