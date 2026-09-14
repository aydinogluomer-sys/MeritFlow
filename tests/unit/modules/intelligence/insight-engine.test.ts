import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { runInsightEngine, IntelligenceRepository, type NewInsightInput } from '@/modules/intelligence';

// The engine's metric read is INJECTED (deps.readMetrics) so we exercise orchestration + idempotency
// without a live DB and without a deep import — the production boundary is still executeSemanticQuery.

// ── A stateful in-memory fake supabase supporting the exact chains recordRecurring + the engine use:
//   bonus_periods:        .select().eq().order().limit().maybeSingle()
//   intelligence_insights: find  .select().eq()×3.in().is|eq()×2.order().limit()  (awaited → rows[])
//                          insert .insert().select().single()
//                          touch  .update().eq().eq().select().single()
type Row = Record<string, unknown>;
class FakeStore {
  insights: Row[] = [];
  periods: Row[] = [];
  seq = 0;
  from(table: string) {
    return new FakeQuery(this, table);
  }
}
class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private ord?: { col: string; asc: boolean };
  private lim?: number;
  private mode: 'select' | 'insert' | 'update' = 'select';
  private payload?: Row;
  constructor(private store: FakeStore, private table: string) {}
  select() { return this; }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  in(col: string, vals: unknown[]) { const s = new Set(vals); this.filters.push((r) => s.has(r[col])); return this; }
  is(col: string, _v: null) { this.filters.push((r) => r[col] === null || r[col] === undefined); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.ord = { col, asc: opts?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  insert(row: Row) { this.mode = 'insert'; this.payload = row; return this; }
  update(patch: Row) { this.mode = 'update'; this.payload = patch; return this; }
  private rows(): Row[] { return this.table === 'intelligence_insights' ? this.store.insights : this.store.periods; }
  private matched(): Row[] {
    let rs = this.rows().filter((r) => this.filters.every((f) => f(r)));
    if (this.ord) {
      const { col, asc } = this.ord;
      rs = [...rs].sort((a, b) => ((a[col] as number) < (b[col] as number) ? -1 : (a[col] as number) > (b[col] as number) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.lim != null) rs = rs.slice(0, this.lim);
    return rs;
  }
  async maybeSingle() { return { data: this.matched()[0] ?? null, error: null }; }
  async single() {
    if (this.mode === 'insert') {
      const id = `ins-${++this.store.seq}`;
      const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, this.store.seq)).toISOString(); // distinct, pre-"now"
      const row: Row = { id, created_at: stamp, first_detected_at: stamp, last_detected_at: stamp, resolved_at: null, resolution_code: null, model_payload: null, ...this.payload };
      this.store.insights.push(row);
      return { data: row, error: null };
    }
    if (this.mode === 'update') {
      const target = this.matched()[0];
      if (target) Object.assign(target, this.payload);
      return { data: target ?? null, error: null };
    }
    return { data: this.matched()[0] ?? null, error: null };
  }
  then(resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) {
    return Promise.resolve({ data: this.matched(), error: null as null }).then(resolve, reject);
  }
}

const ORG = 'a0000000-0000-4000-8000-000000000001';
const PERIOD = 'a0000000-0000-4000-8000-0000000000f1';

function fakeClient(store: FakeStore): SupabaseClient<Database> {
  return { from: (t: string) => store.from(t) } as never;
}
function metricResult(metricId: string, value: number) {
  return {
    metricId,
    results: [{ metricId, value, unit: 'percent', period: { start: '2026-01-01', end: '2026-01-31' }, organizationId: ORG, dimensions: {}, computedAt: '2026-02-01T00:00:00.000Z', sourceVersion: 'metrics-v1' }],
  };
}
// budget_variance 25 → budget_risk (critical); gaming_flag_rate 40 → threshold_breach (critical) = 2 insights.
const OK_OUTCOME = { ok: true as const, metrics: [metricResult('budget_variance', 25), metricResult('gaming_flag_rate', 40)] };

describe('recordRecurring — idempotent emit (dedup by identity)', () => {
  const base: NewInsightInput = {
    organizationId: ORG,
    insightType: 'budget_risk',
    subjectType: 'organization',
    subjectId: null,
    bonusPeriodId: PERIOD,
    severity: 'warning',
    headline: 'Bütçe riski',
    deterministicFacts: { metric: 'budget_variance', value: 12 },
    evidence: [{ sourceType: 'metric', sourceId: 'budget_variance' }],
    suggestedActions: [{ code: 'inspect_budget', label: 'İncele' }],
  };

  it('first call inserts; a second call over the same identity TOUCHES (no duplicate row)', async () => {
    const store = new FakeStore();
    const repo = new IntelligenceRepository(fakeClient(store));

    const first = await repo.recordRecurring(base);
    expect(first.recurred).toBe(false);
    expect(store.insights).toHaveLength(1);
    const firstDetected = store.insights[0]!.last_detected_at;

    const second = await repo.recordRecurring({ ...base, severity: 'critical', deterministicFacts: { metric: 'budget_variance', value: 25 } });
    expect(second.recurred).toBe(true);
    expect(store.insights).toHaveLength(1); // NO duplicate (a naive insert() would have made 2)
    expect(store.insights[0]!.severity).toBe('critical'); // refreshed
    expect(store.insights[0]!.last_detected_at).not.toBe(firstDetected); // touched
  });

  it('a TERMINAL (dismissed) insight of the same identity is NOT touched — a fresh one is inserted', async () => {
    const store = new FakeStore();
    // Seed a dismissed (terminal) insight of the identity.
    store.insights.push({
      id: 'old', organization_id: ORG, insight_type: 'budget_risk', subject_type: 'organization', subject_id: null,
      bonus_period_id: PERIOD, severity: 'warning', status: 'dismissed', deterministic_payload: {}, model_payload: null,
      evidence_refs: [], created_at: '2026-01-01T00:00:00.000Z', first_detected_at: '2026-01-01T00:00:00.000Z',
      last_detected_at: '2026-01-01T00:00:00.000Z', resolved_at: '2026-01-02T00:00:00.000Z', resolution_code: 'x',
    });
    const repo = new IntelligenceRepository(fakeClient(store));

    const res = await repo.recordRecurring(base);
    expect(res.recurred).toBe(false); // dismissed is terminal → not reused
    expect(store.insights).toHaveLength(2);
    expect(store.insights.filter((r) => r.status === 'calculated')).toHaveLength(1); // the fresh one
  });
});

describe('runInsightEngine — reads metrics + emits idempotently', () => {
  function seedPeriod(store: FakeStore) {
    store.periods.push({ id: PERIOD, organization_id: ORG, starts_on: '2026-01-01' });
  }

  it('a re-run over the same metrics creates NO new rows (touches instead)', async () => {
    const store = new FakeStore();
    seedPeriod(store);
    const readMetrics = vi.fn().mockResolvedValue(OK_OUTCOME);

    const run1 = await runInsightEngine({ organizationId: ORG }, fakeClient(store), { readMetrics });
    expect(run1).toMatchObject({ status: 'ok', detected: 2, inserted: 2, recurred: 0 });
    expect(store.insights).toHaveLength(2);

    const run2 = await runInsightEngine({ organizationId: ORG }, fakeClient(store), { readMetrics });
    expect(run2).toMatchObject({ status: 'ok', detected: 2, inserted: 0, recurred: 2 });
    expect(store.insights).toHaveLength(2); // idempotent — no duplicate rows
    // reads went through the metric layer (executeSemanticQuery), never raw SQL
    expect(readMetrics).toHaveBeenCalled();
  });

  it('no bonus period → emits nothing (status no_period), never reads metrics', async () => {
    const store = new FakeStore(); // no periods
    const readMetrics = vi.fn();
    const res = await runInsightEngine({ organizationId: ORG }, fakeClient(store), { readMetrics });
    expect(res).toMatchObject({ status: 'no_period', detected: 0, inserted: 0, recurred: 0 });
    expect(store.insights).toHaveLength(0);
    expect(readMetrics).not.toHaveBeenCalled();
  });

  it('metrics unavailable (feature off / RLS-denied → ok:false) → emits nothing, never fabricates', async () => {
    const store = new FakeStore();
    seedPeriod(store);
    const readMetrics = vi.fn().mockResolvedValue({ ok: false, executionErrors: [{ code: 'feature_disabled', message: 'x' }] });
    const res = await runInsightEngine({ organizationId: ORG }, fakeClient(store), { readMetrics });
    expect(res).toMatchObject({ status: 'metrics_unavailable', detected: 0, inserted: 0 });
    expect(store.insights).toHaveLength(0);
  });
});
