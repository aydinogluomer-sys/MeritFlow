import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureFlagResolver, FeatureFlagKeySchema, FEATURE_FLAG_KEYS } from '@/modules/intelligence';

/** feature_flags.select().eq().eq().maybeSingle() -> { data, error } */
function mockClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq2 = vi.fn().mockReturnValue({ maybeSingle });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, from };
}

beforeEach(() => vi.clearAllMocks());

describe('FeatureFlagResolver (fail-closed)', () => {
  it('resolves enabled=true when a row is enabled', async () => {
    const { client, from } = mockClient({
      data: { flag_key: 'intelligence', enabled: true, stage: 'beta' },
      error: null,
    });
    const resolver = new FeatureFlagResolver(client, 'org-1');
    expect(await resolver.isEnabled('intelligence')).toBe(true);
    expect(from).toHaveBeenCalledWith('feature_flags');
    expect(await resolver.resolve('intelligence')).toEqual({
      key: 'intelligence',
      enabled: true,
      stage: 'beta',
    });
  });

  it('resolves false when the row is disabled', async () => {
    const { client } = mockClient({
      data: { flag_key: 'assist', enabled: false, stage: 'off' },
      error: null,
    });
    const resolver = new FeatureFlagResolver(client, 'org-1');
    expect(await resolver.isEnabled('assist')).toBe(false);
  });

  it('resolves false (fail-closed) when no row exists', async () => {
    const { client } = mockClient({ data: null, error: null });
    const resolver = new FeatureFlagResolver(client, 'org-1');
    expect(await resolver.isEnabled('digital_twin')).toBe(false);
    expect(await resolver.resolve('digital_twin')).toBeNull();
  });

  it('resolves false (fail-closed) on a read error', async () => {
    const { client } = mockClient({ data: null, error: { message: 'boom' } });
    const resolver = new FeatureFlagResolver(client, 'org-1');
    expect(await resolver.isEnabled('health_engine')).toBe(false);
  });
});

describe('FeatureFlagKeySchema', () => {
  it('accepts every seeded module key', () => {
    for (const k of FEATURE_FLAG_KEYS) expect(FeatureFlagKeySchema.safeParse(k).success).toBe(true);
  });
  it('rejects an unknown key', () => {
    expect(FeatureFlagKeySchema.safeParse('not_a_flag').success).toBe(false);
  });
});
