import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/features/shared/empty-state';
import { ErrorState } from '@/components/features/shared/error-state';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

type AuditRow = {
  id: string;
  action: string;
  actor_id: string | null;
  target_type: string | null;
  target_id: string | null;
  is_sensitive: boolean;
  created_at: string;
};

export default async function AuditPage() {
  if (!(await hasPermission('audit.read'))) redirect('/unauthorized');

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, action, actor_id, target_type, target_id, is_sensitive, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = (data ?? []) as AuditRow[];

  // Resolve actor display names (profiles is RLS-scoped identity).
  const actorIds = [
    ...new Set(rows.map((r) => r.actor_id).filter((v): v is string => typeof v === 'string')),
  ];
  const nameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', actorIds);
    for (const p of (profiles ?? []) as Array<{ id: string; display_name: string }>) {
      nameById.set(p.id, p.display_name);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Denetim kayıtları</h1>
        <p className="text-sm text-muted-foreground">
          Değiştirilemez, yalnızca eklenebilir denetim izi. Kritik mutasyonlar (düzeltme,
          onay, karar, dışa aktarım, rol değişimi vb.) burada iz bırakır.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kayıtlar</CardTitle>
          <CardDescription>En yeni 200 kayıt (en yeni önce).</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorState message="Denetim kayıtları yüklenemedi." />
          ) : rows.length === 0 ? (
            <EmptyState message="Henüz denetim kaydı yok" />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Denetim kayıtları listesi</caption>
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">
                      Zaman
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Eylem
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Aktör
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Hedef
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {dateFormatter.format(new Date(row.created_at))}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs">{row.action}</span>
                        {row.is_sensitive ? (
                          <Badge variant="destructive" className="ml-2">
                            Hassas
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {row.actor_id
                          ? (nameById.get(row.actor_id) ?? row.actor_id)
                          : 'Sistem'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.target_type ?? '—'}
                        {row.target_id ? (
                          <span className="ml-1 font-mono text-xs">
                            #{row.target_id.slice(0, 8)}
                          </span>
                        ) : null}
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
