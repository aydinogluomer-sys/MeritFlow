import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '../../next.config';
import { buildCsp } from '../../proxy';

// ENGINEERING-08: pins the baseline security response headers so a regression (someone dropping
// HSTS / frame protection / the no-surveillance Permissions-Policy) fails CI.
const byKey = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value] as const));

describe('security headers (ENGINEERING-08)', () => {
  it('sets HSTS with a long max-age', () => {
    expect(byKey['Strict-Transport-Security']).toMatch(/max-age=\d{6,}/);
    expect(byKey['Strict-Transport-Security']).toContain('includeSubDomains');
  });

  it('denies framing (clickjacking protection)', () => {
    expect(byKey['X-Frame-Options']).toBe('DENY');
  });

  it('blocks MIME sniffing', () => {
    expect(byKey['X-Content-Type-Options']).toBe('nosniff');
  });

  it('sets a privacy-preserving Referrer-Policy', () => {
    expect(byKey['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('Permissions-Policy disables camera / microphone / geolocation (no surveillance — CLAUDE.md)', () => {
    const pp = byKey['Permissions-Policy'];
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
  });

  it('CSP is enforced per-request via proxy.ts nonce (not in static headers)', () => {
    // Static headers no longer carry either CSP variant — the enforcing nonce-keyed CSP lives in
    // proxy.ts (ENGINEERING-19). Neither key should appear here.
    expect(byKey['Content-Security-Policy-Report-Only']).toBeUndefined();
    expect(byKey['Content-Security-Policy']).toBeUndefined();
  });

  it('buildCsp() produces a nonce-keyed enforcing policy without unsafe-inline in script-src', () => {
    const csp = buildCsp('test-nonce-abc');
    expect(csp).toContain("'nonce-test-nonce-abc'");
    expect(csp).toContain("'strict-dynamic'");
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
});
