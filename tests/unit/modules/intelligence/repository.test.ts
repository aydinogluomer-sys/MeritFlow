import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntelligenceRepository } from '@/modules/intelligence';

const EVIDENCE = { sourceType: 'metric' as const, sourceId: 'payout_total' };
const ACTION = { code: 'inspect', label: 'İncele' };

beforeEach(() => vi.clearAllMocks());

describe('IntelligenceRepository.insert — enforces the evidence+action invariant', () => {
  it('rejects an insight with no evidence BEFORE any DB write', async () => {
    const from = vi.fn();
    const repo = new IntelligenceRepository({ from } as never);
    await expect(
      repo.insert({
        organizationId: 'org-1',
        insightType: 't',
        subjectType: 'team',
        severity: 'info',
        headline: 'h',
        deterministicFacts: {},
        evidence: [],
        suggestedActions: [ACTION],
      }),
    ).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects an insight with no suggested action BEFORE any DB write', async () => {
    const from = vi.fn();
    const repo = new IntelligenceRepository({ from } as never);
    await expect(
      repo.insert({
        organizationId: 'org-1',
        insightType: 't',
        subjectType: 'team',
        severity: 'info',
        headline: 'h',
        deterministicFacts: {},
        evidence: [EVIDENCE],
        suggestedActions: [],
      }),
    ).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });
});

describe('IntelligenceRepository.transition — enforces the §2.8 status machine', () => {
  function repoWithCurrentStatus(status: string) {
    // getById reads: from().select().eq().eq().maybeSingle()
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'i1',
        organization_id: 'org-1',
        insight_type: 't',
        subject_type: 'team',
        subject_id: null,
        bonus_period_id: null,
        severity: 'info',
        status,
        deterministic_payload: { headline: 'h', facts: {}, suggestedActions: [ACTION] },
        model_payload: null,
        evidence_refs: [EVIDENCE],
        first_detected_at: 'x',
        last_detected_at: 'x',
        resolved_at: null,
        resolution_code: null,
        created_at: 'x',
      },
      error: null,
    });
    const selectRead = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) }),
    });
    const from = vi.fn().mockReturnValue({ select: selectRead });
    return { repo: new IntelligenceRepository({ from } as never), from };
  }

  it('throws on an illegal transition and never issues the UPDATE', async () => {
    const { repo, from } = repoWithCurrentStatus('draft');
    await expect(repo.transition('i1', 'org-1', 'applied')).rejects.toThrow(
      /illegal insight status transition/,
    );
    // Only the getById read happened (one from() call); no update path.
    expect(from).toHaveBeenCalledTimes(1);
  });
});
