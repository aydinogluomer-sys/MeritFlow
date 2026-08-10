import Link from 'next/link';
import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ManualOverrideForm,
  type MemberOption,
  type TaskOption,
} from '@/components/features/points/manual-override-form';

export default async function PointOverridePage() {
  if (!(await hasPermission('point.override'))) redirect('/unauthorized');

  const supabase = await createClient();
  const org = await getActiveOrg();

  // Org members (both the target employee and the second approver come from here).
  const { data: members } = await supabase
    .from('memberships')
    .select('profile_id, profiles(id, display_name)')
    .eq('organization_id', org!.organization_id)
    .eq('status', 'active');

  type MemberRow = {
    profile_id: string;
    profiles: Array<{ id: string; display_name: string }> | { display_name: string } | null;
  };

  const memberOptions: MemberOption[] = ((members ?? []) as unknown as MemberRow[]).map(
    (m) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return { id: m.profile_id, label: profile?.display_name ?? m.profile_id };
    },
  );

  // Optional tasks the adjustment can reference (RLS-scoped). Newest first, bounded.
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title')
    .order('created_at', { ascending: false })
    .limit(200);

  const taskOptions: TaskOption[] = (
    (tasks ?? []) as Array<{ id: string; title: string }>
  ).map((t) => ({ id: t.id, label: t.title }));

  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="self-start px-2">
        <Link href="/points">← Puanlara dön</Link>
      </Button>

      <div>
        <h1 className="text-2xl font-semibold">Manuel puan düzeltmesi</h1>
        <p className="text-sm text-muted-foreground">
          İki kişilik kontrolle puan defterine ayrı bir düzeltme kaydı yazılır. Defter
          değiştirilmez; işlem denetim kaydı üretir.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Düzeltme</CardTitle>
          <CardDescription>
            Çalışan, opsiyonel görev, puan farkı, gerekçe ve ikinci onaylayan seçin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ManualOverrideForm memberOptions={memberOptions} taskOptions={taskOptions} />
        </CardContent>
      </Card>
    </div>
  );
}
