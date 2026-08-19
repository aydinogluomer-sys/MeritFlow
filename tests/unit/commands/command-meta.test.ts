import { describe, expect, it } from 'vitest';
import { newCommand, commandFrom, COMMAND_OPERATIONS } from '@/lib/commands/command-meta';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('newCommand()', () => {
  it('returns an object with two valid UUID strings', () => {
    const c = newCommand();
    expect(c.commandId).toMatch(UUID_RE);
    expect(c.correlationId).toMatch(UUID_RE);
  });

  it('commandId === correlationId on a fresh call', () => {
    const c = newCommand();
    expect(c.commandId).toBe(c.correlationId);
  });

  it('two consecutive calls return different commandIds', () => {
    expect(newCommand().commandId).not.toBe(newCommand().commandId);
  });
});

describe('commandFrom()', () => {
  it('reuses a supplied commandId (stable across retries)', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    expect(commandFrom(id)).toEqual({ commandId: id, correlationId: id });
  });

  it('mints a stable UUID when none is supplied', () => {
    const c = commandFrom(undefined);
    expect(c.commandId).toMatch(UUID_RE);
    expect(c.commandId).toBe(c.correlationId);
  });
});

describe('COMMAND_OPERATIONS', () => {
  it('covers the 10 critical operations', () => {
    expect(Object.keys(COMMAND_OPERATIONS)).toHaveLength(10);
  });
});
