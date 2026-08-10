import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { createClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ErrorState } from '@/components/features/shared/error-state';
import { DisputeList, type DisputeListRow } from '@/components/features/disputes/dispute-list';

const OPEN_STATUSES = ['open', 'under_review', 'needs_info'];
const CLOSED_STATUSES = ['resolved', 'closed'];

const DISPUTE_COLUMNS = 'id, dispute_type, target_type, status, resolution, opened_at';

export default async function DisputesPage() {
  const canOpen = await hasPermission('dispute.open');
  const canResolve = await hasPermission('dispute.resolve');
  if (!canOpen && !canResolve) redirect('/unauthorized');

  const supabase = await createClient();

  // RLS scopes rows to complainant + assigned reviewer + HR + Auditor.
  const [openRes, closedRes] = await Promise.all([
    supabase
      .from('disputes')
      .select(DISPUTE_COLUMNS)
      .in('status', OPEN_STATUSES)
      .order('opened_at', { ascending: false }),
    supabase
      .from('disputes')
      .select(DISPUTE_COLUMNS)
      .in('status', CLOSED_STATUSES)
      .order('opened_at', { ascending: false }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">İtirazlar</h1>
        <p className="text-sm text-muted-foreground">
          Puan, prim ve inceleme kararlarına yönelik itirazlar. İnsan denetimli; otomatik
          ceza yoktur.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Açık itirazlar</CardTitle>
          <CardDescription>Devam eden ve incelemeyi bekleyen itirazlar.</CardDescription>
        </CardHeader>
        <CardContent>
          {openRes.error ? (
            <ErrorState message="Açık itirazlar yüklenemedi." />
          ) : (
            <DisputeList
              disputes={(openRes.data ?? []) as DisputeListRow[]}
              emptyMessage="Açık itiraz yok"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sonuçlanan itirazlar</CardTitle>
          <CardDescription>Çözülmüş ve kapanmış itirazlar.</CardDescription>
        </CardHeader>
        <CardContent>
          {closedRes.error ? (
            <ErrorState message="Sonuçlanan itirazlar yüklenemedi." />
          ) : (
            <DisputeList
              disputes={(closedRes.data ?? []) as DisputeListRow[]}
              emptyMessage="Sonuçlanan itiraz yok"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
