import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

describe('env', () => {
  it('parses valid public env', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    const { publicEnv } = await import('@/lib/env');
    expect(publicEnv.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon');
  });

  it('serverEnv() returns the service-role key on the server', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret-service-role';
    const { serverEnv } = await import('@/lib/env');
    expect(serverEnv().SUPABASE_SERVICE_ROLE_KEY).toBe('secret-service-role');
  });

  it('serverEnv() throws if the service-role key is exposed as NEXT_PUBLIC_ (SI-11)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret-service-role';
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY = 'leaked';
    const { serverEnv } = await import('@/lib/env');
    expect(() => serverEnv()).toThrow(/never be exposed as NEXT_PUBLIC_/);
  });
});
