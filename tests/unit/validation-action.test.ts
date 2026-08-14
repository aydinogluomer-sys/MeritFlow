import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/logger', () => ({ captureServerError: vi.fn().mockResolvedValue(undefined) }));

import { validatedAction } from '@/lib/validation/action';
import { DomainError } from '@/lib/errors';
import { captureServerError } from '@/lib/logger';

const captureServerErrorMock = vi.mocked(captureServerError);

describe('validatedAction', () => {
  const schema = z.object({ name: z.string().min(1) });

  beforeEach(() => captureServerErrorMock.mockClear());

  it('runs the handler on valid input', async () => {
    const action = validatedAction(schema, async (input) => `hi ${input.name}`);
    const res = await action({ name: 'ada' });
    expect(res).toEqual({ ok: true, data: 'hi ada' });
  });

  it('returns VALIDATION_ERROR with fieldErrors on invalid input', async () => {
    const action = validatedAction(schema, async () => 'unreachable');
    const res = await action({ name: '' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('VALIDATION_ERROR');
      expect(res.fieldErrors?.name).toBeDefined();
    }
  });

  it('captures handler errors as a failed result (never throws)', async () => {
    const action = validatedAction(schema, async () => {
      throw new Error('BOOM');
    });
    const res = await action({ name: 'x' });
    expect(res).toEqual({ ok: false, error: 'BOOM' });
  });

  it('maps a thrown DomainError to its stable code (no raw message leak)', async () => {
    const action = validatedAction(schema, async () => {
      throw new DomainError('RLS_DENIED', { message: 'new row violates row-level security policy' });
    });
    const res = await action({ name: 'x' });
    expect(res).toEqual({ ok: false, error: 'RLS_DENIED' });
  });

  it('carries fieldErrors from a DomainError', async () => {
    const action = validatedAction(schema, async () => {
      throw new DomainError('VALIDATION_ERROR', { fieldErrors: { name: ['bad'] } });
    });
    const res = await action({ name: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('VALIDATION_ERROR');
      expect(res.fieldErrors?.name).toEqual(['bad']);
    }
  });

  it('captures an INTERNAL DomainError (unexpected infra failure)', async () => {
    const action = validatedAction(schema, async () => {
      throw new DomainError('INTERNAL', { originalError: { code: 'ZZZ' } });
    });
    await action({ name: 'x' });
    expect(captureServerErrorMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT capture an expected DomainError (FORBIDDEN)', async () => {
    const action = validatedAction(schema, async () => {
      throw new DomainError('FORBIDDEN');
    });
    await action({ name: 'x' });
    expect(captureServerErrorMock).not.toHaveBeenCalled();
  });
});
