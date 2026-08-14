import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '../../next.config';

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

  it('ships a CSP baseline (report-only) that locks framing and defaults to self', () => {
    const csp = byKey['Content-Security-Policy-Report-Only'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // Report-Only (not enforcing) until the CSP is validated against golden-path E2E (11).
    expect(byKey['Content-Security-Policy']).toBeUndefined();
  });
});
