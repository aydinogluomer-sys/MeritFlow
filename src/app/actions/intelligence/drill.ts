'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { requirePermission, getPermissions } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { buildDrillQuery, executeSemanticQuery, type DrillLevel } from '@/modules/intelligence';
import { DrillMetricSchema } from '@/lib/validation/schemas/intelligence-drill';

/**
 * Permission-aware drill (§10.10). Floor gate: intelligence.read (server-side, AD1). The plan is built
 * by buildDrillQuery (rejects unservable metric/level) and run through executeSemanticQuery — which
 * re-runs the P0 validator (sensitive employee level requires intelligence.manage) and RLS-scopes every
 * read (Finance financial via v_finance_* — SI-12). NO raw SQL (§26). Returns the drilled slice rows.
 */
export const drillMetricAction = validatedAction(DrillMetricSchema, async (input) => {
  await requirePermission('intelligence.read');
  const org = await getActiveOrg();
  if (!org) return { drilled: false as const, error: 'no_org' };
  const perms = await getPermissions();
  const supabase = await createClient();

  const period = input.bonusPeriodId
    ? ({ kind: 'bonus_period', bonusPeriodId: input.bonusPeriodId } as const)
    : ({ kind: 'relative', trailing: 'current' } as const);
  const built = buildDrillQuery({ metric: input.metric, level: input.level as DrillLevel, period });
  if (!built.ok) return { drilled: false as const, error: built.error.code };

  const outcome = await executeSemanticQuery(
    supabase,
    { organizationId: org.organization_id, permissions: perms, role: org.primary_role },
    built.query,
  );
  if (!outcome.ok) {
    const code = outcome.executionErrors?.[0]?.code ?? outcome.validationErrors?.[0]?.code ?? 'query_failed';
    return { drilled: false as const, error: code };
  }
  const mqr = outcome.metrics.find((m) => m.metricId === input.metric);
  return {
    drilled: true as const,
    level: input.level,
    rows: (mqr?.results ?? []).map((r) => ({
      key: JSON.stringify(Object.entries(r.dimensions).sort()),
      dimensions: r.dimensions,
      value: r.value,
      unit: r.unit,
    })),
  };
});
