import Link from 'next/link';
import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { Badge, type BadgeProps } from '@/components/ui/badge';
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
import {
  DisputeFlowForm,
  type ReviewerOption,
} from '@/components/features/disputes/dispute-flow-form';
import type { AdjustmentPeriodOption } from '@/components/features/disputes/dispute-adjustment-form';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const periodDateFormatter = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' });

const TYPE_LABELS: Record<string, string> = {
  task_points_too_low: 'Puan çok düşük',
  unfair_rejection: 'Haksız ret',
  quality_score_dispute: 'Kalite puanı itirazı',
  missing_task_credit: 'Eksik görev kredisi',
  bonus_calculation_dispute: 'Prim hesabı itirazı',
  manager_bias_report: 'Yönetici önyargısı',
  anomaly_false_positive: 'Yanlış anomali',
  system_error: 'Sistem hatası',
  clawback_dispute: 'Geri alma itirazı',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Açık',
  under_review: 'İncelemede',
  needs_info: 'Bilgi bekleniyor',
  resolved: 'Çözüldü',
  closed: 'Kapandı',
};

const STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  open: 'outline',
  under_review: 'secondary',
  needs_info: 'outline',
  resolved: 'default',
  closed: 'outline',
};

const RESOLUTION_LABELS: Record<string, string> = {
  accepted: 'Kabul edildi',
  rejected: 'Reddedildi',
};

export default async function DisputeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const canOpen = await hasPermission('dispute.open');
  const canResolve = await hasPermission('dispute.resolve');
  if (!canOpen && !canResolve) redirect('/unauthorized');

  const { id } = await params;
  const supabase = await createClient();

  const { data: dispute, error } = await supabase
    .from('disputes')
    .select(
      'id, dispute_type, target_type, target_id, status, resolution, decision_note, complainant_id, decision_owner_id, assigned_reviewer_id, opened_at, resolved_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <ErrorState message="İtiraz yüklenemedi." />
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <EmptyState message="İtiraz bulunamadı veya görüntüleme yetkin yok." />
      </div>
    );
  }

  // Resolver step data is only fetched/shown to users with dispute.resolve.
  let reviewerOptions: ReviewerOption[] = [];
  let periodOptions: AdjustmentPeriodOption[] = [];
  if (canResolve) {
    const org = await getActiveOrg();

    // Candidate reviewers: active org members, excluding the complainant and the
    // decision owner (D9 — enforced by the DB too; we pre-filter for UX).
    const { data: members } = await supabase
      .from('memberships')
      .select('profile_id, profiles(id, display_name)')
      .eq('organization_id', org!.organization_id)
      .eq('status', 'active');

    const excluded = new Set(
      [dispute.complainant_id, dispute.decision_owner_id].filter(
        (v): v is string => typeof v === 'string',
      ),
    );

    type MemberRow = {
      profile_id: string;
      // Supabase types the embedded relation as an array (one-to-many inference).
      profiles: Array<{ id: string; display_name: string }> | { display_name: string } | null;
    };

    reviewerOptions = ((members ?? []) as unknown as MemberRow[])
      .filter((m) => !excluded.has(m.profile_id))
      .map((m) => {
        const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
        return {
          id: m.profile_id,
          label: profile?.display_name ?? m.profile_id,
        };
      });

    const { data: periods } = await supabase
      .from('bonus_periods')
      .select('id, starts_on, ends_on')
      .order('starts_on', { ascending: false });

    periodOptions = (
      (periods ?? []) as Array<{ id: string; starts_on: string; ends_on: string }>
    ).map((p) => ({
      id: p.id,
      label: `${periodDateFormatter.format(new Date(p.starts_on))} – ${periodDateFormatter.format(
        new Date(p.ends_on),
      )}`,
    }));
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {TYPE_LABELS[dispute.dispute_type] ?? dispute.dispute_type}
        </h1>
        <Badge variant={STATUS_VARIANTS[dispute.status] ?? 'outline'}>
          {STATUS_LABELS[dispute.status] ?? dispute.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>İtiraz bilgileri</CardTitle>
          <CardDescription>İnsan denetimli; karar denetim kaydı üretir.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <Field label="Hedef türü" value={dispute.target_type} className="capitalize" />
          <Field label="Açılış" value={dateFormatter.format(new Date(dispute.opened_at))} />
          <Field
            label="Sonuç"
            value={
              dispute.resolution
                ? (RESOLUTION_LABELS[dispute.resolution] ?? dispute.resolution)
                : '—'
            }
          />
          <Field
            label="Çözülme"
            value={
              dispute.resolved_at
                ? dateFormatter.format(new Date(dispute.resolved_at))
                : '—'
            }
          />
          {dispute.decision_note ? (
            <div className="sm:col-span-2">
              <Field label="Karar notu" value={dispute.decision_note} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canResolve && (dispute.status === 'open' || dispute.status === 'under_review') ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {dispute.status === 'open' ? 'İnceleyen ata' : 'İtirazı sonuçlandır'}
            </CardTitle>
            <CardDescription>
              {dispute.status === 'open'
                ? 'İtirazı incelemeye almak için bir inceleyen atayın (D9).'
                : 'Kararı verin; kabul halinde puan düzeltmesi ve gerekirse yeniden hesaplama uygulanır.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DisputeFlowForm
              disputeId={dispute.id}
              status={dispute.status}
              reviewerOptions={reviewerOptions}
              periodOptions={periodOptions}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="self-start px-2">
      <Link href="/disputes">← İtirazlara dön</Link>
    </Button>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={className}>{value}</span>
    </div>
  );
}
