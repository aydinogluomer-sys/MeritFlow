import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/auth/org';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/features/shared/empty-state';

const pointFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

type LeaderboardRpcRow = {
  rank: number;
  display_name: string;
  total_points: number;
  is_self: boolean;
};

export default async function LeaderboardPage() {
  // createClient() uses the user's session (anon key + cookies) — NOT adminClient.
  // get_leaderboard is granted to `authenticated` only; service_role would get 42501.
  // auth.uid() inside the SECURITY DEFINER function resolves to the calling user,
  // enabling the privacy-first anonymisation (AD5) and the cross-tenant guard.
  const supabase = await createClient();
  const org = await getActiveOrg();

  const { data, error } = org
    ? await supabase.rpc('get_leaderboard', {
        p_organization_id: org.organization_id,
      })
    : { data: null, error: null };

  const rows = (data ?? []) as LeaderboardRpcRow[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Sıralama</h1>
        <p className="text-sm text-muted-foreground">
          Onaylanmış işten kazanılan toplam puanlar. Gizlilik önceliklidir: yalnızca
          görme yetkin olan satırlar gösterilir.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Puan sıralaması</CardTitle>
          <CardDescription>
            Kendi adın görünür; diğer çalışanlar gizlilik amacıyla anonimleştirilmiştir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <EmptyState message="Sıralama şu anda gösterilemiyor." />
          ) : rows.length === 0 ? (
            <EmptyState message="Sıralama için henüz puan yok" />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Puan sıralaması</caption>
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">
                      Sıra
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Çalışan
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Puan
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.rank}-${row.display_name}`}
                      className={`border-b last:border-0 ${
                        row.is_self ? 'bg-primary/5 font-medium' : 'hover:bg-muted/30'
                      }`}
                    >
                      <td className="px-4 py-3 tabular-nums">{row.rank}</td>
                      <td className="px-4 py-3">
                        {row.display_name}
                        {row.is_self ? (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            Sen
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {pointFormatter.format(row.total_points)}
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
