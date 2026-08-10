import * as React from 'react';

/**
 * The `metadata` jsonb written on a `task_approved` point_ledger row by the scoring
 * engine (migration 0020). All fields are optional/defensive: a row from another event
 * type (manual_adjustment / reversal) has no such metadata.
 */
export type ScoringMetadata = {
  base_points?: number | null;
  complexity?: string | null;
  complexity_multiplier?: number | null;
  impact?: string | null;
  impact_multiplier?: number | null;
  quality?: string | null;
  quality_multiplier?: number | null;
  timeliness?: string | null;
  timeliness_multiplier?: number | null;
  revision_count?: number | null;
  revision_penalty_rate?: number | null;
  collaboration_score?: string | null;
  final_points?: number | null;
} | null;

const numberFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });
const percentFormatter = new Intl.NumberFormat('tr-TR', {
  style: 'percent',
  maximumFractionDigits: 1,
});

function fmtNum(value: number | null | undefined): string {
  return value == null ? '—' : numberFormatter.format(value);
}

function fmtMultiplier(value: number | null | undefined): string {
  return value == null ? '—' : `×${numberFormatter.format(value)}`;
}

export interface PointBreakdownProps {
  metadata: ScoringMetadata;
}

/**
 * "Neden bu puan?" — renders the deterministic scoring factors for a `task_approved`
 * ledger row from its `metadata` (base × complexity × impact × quality × timeliness ×
 * (1 − revision penalty)). Collaboration is shown for transparency but does NOT affect
 * points (AD5). Purely presentational.
 */
export function PointBreakdown({ metadata }: PointBreakdownProps) {
  if (!metadata) {
    return (
      <p className="text-sm text-muted-foreground">
        Bu kayıt için puan kırılımı yok (yalnızca onaylanmış görev puanları kırılım taşır).
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Factor label="Taban puan" value={fmtNum(metadata.base_points)} />
        <Factor
          label="Karmaşıklık"
          value={metadata.complexity ?? '—'}
          detail={fmtMultiplier(metadata.complexity_multiplier)}
        />
        <Factor
          label="Etki"
          value={metadata.impact ?? '—'}
          detail={fmtMultiplier(metadata.impact_multiplier)}
        />
        <Factor
          label="Kalite"
          value={metadata.quality ?? '—'}
          detail={fmtMultiplier(metadata.quality_multiplier)}
        />
        <Factor
          label="Zamanında"
          value={metadata.timeliness ?? '—'}
          detail={fmtMultiplier(metadata.timeliness_multiplier)}
        />
        <Factor
          label="Revizyon cezası"
          value={
            metadata.revision_penalty_rate != null
              ? percentFormatter.format(metadata.revision_penalty_rate)
              : '—'
          }
          detail={
            metadata.revision_count != null
              ? `${metadata.revision_count} revizyon`
              : undefined
          }
        />
        <Factor
          label="İş birliği (puana etkisiz)"
          value={metadata.collaboration_score ?? '—'}
        />
        <Factor label="Nihai puan" value={fmtNum(metadata.final_points)} emphasize />
      </dl>
      <p className="text-xs text-muted-foreground">
        Nihai puan = taban × karmaşıklık × etki × kalite × zamanında × (1 − revizyon cezası).
        İş birliği puanı nihai puanı etkilemez (AD5).
      </p>
    </div>
  );
}

function Factor({
  label,
  value,
  detail,
  emphasize,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={emphasize ? 'font-semibold tabular-nums' : 'tabular-nums'}>
        <span className="capitalize">{value}</span>
        {detail ? <span className="ml-2 text-xs text-muted-foreground">{detail}</span> : null}
      </dd>
    </div>
  );
}
