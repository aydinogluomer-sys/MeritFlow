import { MetricCard } from '@/components/intelligence';
import { healthStatus } from './view';

// §3.7 header: policy version + overall health (N/100) + "N issues require review". The overall is
// shown here as a headline; its DERIVATION (weighted aggregate of sub-scores) is rendered separately
// by OverallDerivation so the number is never opaque (§26). Server-safe (presentational).
export function HealthHeader({
  versionNo,
  overallScore,
  overallDelta,
  issueCount,
}: {
  versionNo: number;
  overallScore: number;
  overallDelta: number | null; // vs previous version (null when there is no previous)
  issueCount: number;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-md">
        <MetricCard
          label={`Politika v${versionNo} — Genel sağlık`}
          value={overallScore}
          unit="/ 100"
          delta={overallDelta ?? undefined}
          deltaHigherIsBetter
          status={healthStatus(overallScore)}
          definition="Alt boyut skorlarının belgelenmiş ağırlıklı ortalaması (opak sayı değil — aşağıdaki türetime bakın)."
        />
      </div>
      <p className="text-sm font-medium" role="status">
        {issueCount === 0 ? (
          <span className="text-muted-foreground">İnceleme gerektiren risk yok.</span>
        ) : (
          <span>
            <span className="tabular-nums">{issueCount}</span> risk inceleme gerektiriyor.
          </span>
        )}
      </p>
    </div>
  );
}
