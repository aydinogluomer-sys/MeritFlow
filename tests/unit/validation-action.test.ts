import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validatedAction } from '@/lib/validation/action';

describe('validatedAction', () => {
  const schema = z.object({ name: z.string().min(1) });

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
});
