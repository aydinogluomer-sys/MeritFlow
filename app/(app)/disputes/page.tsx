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
import {
  StatusFilter,
  type StatusFilterOption,
} from '@/components/features/shared/status-filter';
import { DisputeList, type DisputeListRow } from '@/components/features/disputes/dispute-list';

const OPEN_STATUSES = ['open', 'under_review', 'needs_info'];
const CLOSED_STATUSES = ['resolved', 'closed'];

const DISPUTE_COLUMNS = 'id, dispute_type, target_type, status, resolution, opened_at';

// URL filter values. `all` is the no-filter sentinel (both cards shown).
const STATUS_FILTERS = ['open', 'closed', 'all'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const FILTER_OPTIONS: readonly StatusFilterOption[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'open', label: 'Açık' },
  { value: 'closed', label: 'Kapalı' },
];

function normalizeStatus(raw: string | string[] | undefined): StatusFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (STATUS_FILTERS as readonly string[]).includes(value ?? '')
    ? (value as StatusFilter)
    : 'all';
}

export default async function DisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const canOpen = await hasPermission('dispute.open');
  const canResolve = await hasPermission('dispute.resolve');
  if (!canOpen && !canResolve) redirect('/unauthorized');

  // Next 16: searchParams is a Promise. The status filter is applied server-side below;
  // the page stays a server component (gate + fetch preserved).
  const status = normalizeStatus((await searchParams).status);
  const showOpen = status === 'all' || status === 'open';
  const showClosed = status === 'all' || status === 'closed';

  const supabase = await createClient();

  // RLS scopes rows to complainant + assigned reviewer + HR + Auditor. Only fetch the
  // status group(s) the current filter needs.
  const [openRes, closedRes] = await Promise.all([
    showOpen
      ? supabase
          .from('disputes')
          .select(DISPUTE_COLUMNS)
          .in('status', OPEN_STATUSES)
          .order('opened_at', { ascending: false })
      : null,
    showClosed
      ? supabase
          .from('disputes')
          .select(DISPUTE_COLUMNS)
          .in('status', CLOSED_STATUSES)
          .order('opened_at', { ascending: false })
      : null,
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

      <StatusFilter options={FILTER_OPTIONS} ariaLabel="İtiraz durumu filtresi" />

      {showOpen ? (
        <Card>
          <CardHeader>
            <CardTitle>Açık itirazlar</CardTitle>
            <CardDescription>Devam eden ve incelemeyi bekleyen itirazlar.</CardDescription>
          </CardHeader>
          <CardContent>
            {openRes?.error ? (
              <ErrorState message="Açık itirazlar yüklenemedi." />
            ) : (
              <DisputeList
                disputes={(openRes?.data ?? []) as DisputeListRow[]}
                emptyMessage="Açık itiraz yok"
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {showClosed ? (
        <Card>
          <CardHeader>
            <CardTitle>Sonuçlanan itirazlar</CardTitle>
            <CardDescription>Çözülmüş ve kapanmış itirazlar.</CardDescription>
          </CardHeader>
          <CardContent>
            {closedRes?.error ? (
              <ErrorState message="Sonuçlanan itirazlar yüklenemedi." />
            ) : (
              <DisputeList
                disputes={(closedRes?.data ?? []) as DisputeListRow[]}
                emptyMessage="Sonuçlanan itiraz yok"
              />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
