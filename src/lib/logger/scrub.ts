// Scrubbing for structured logs (ENGINEERING-04). NOTHING sensitive is ever logged: JWT/Bearer
// tokens, email addresses, the service-role key (SI-11), and comp-sensitive object values are
// redacted. Applied at both the string (log message) and object (originalError payload) level.

const JWT_RE = /Bearer\s+[\w-]+\.[\w-]+\.[\w-]+/gi;
const EMAIL_RE = /[\w.+%-]+@[\w-]+\.[\w.]+/g;

/** Comp-sensitive object keys — their VALUES are redacted regardless of content (AD3). */
const COMP_KEYS = /salary|compensation|comp_|payout|wage|amount/i;

/**
 * Other PII / secret object keys whose VALUES must never be logged (ENGINEERING-20 §9A):
 * credentials (password/secret/token), raw dispute narrative, and full employee-name payloads.
 * Correlation ids (requestId/traceId/correlationId) are opaque uuids and are intentionally NOT
 * matched here — they must survive scrubbing so a request is traceable end-to-end.
 */
const PII_KEYS = /password|secret|token|narrative|full_name|display_name/i;

export function scrubString(s: string): string {
  let r = s;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (serviceKey && r.includes(serviceKey)) r = r.replaceAll(serviceKey, '[REDACTED:secret]');
  r = r.replace(JWT_RE, '[REDACTED:jwt]');
  r = r.replace(EMAIL_RE, '[REDACTED:email]');
  return r;
}

/** Recursively scrub a value. Depth-capped to avoid circular-ref / deep-object hangs. */
export function scrubValue(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[DEPTH_LIMIT]';
  if (typeof v === 'string') return scrubString(v);
  if (typeof v === 'number' || typeof v === 'boolean' || v == null) return v;
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1));
  if (typeof v === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      result[k] = COMP_KEYS.test(k)
        ? '[REDACTED:comp]'
        : PII_KEYS.test(k)
          ? '[REDACTED:pii]'
          : scrubValue(val, depth + 1);
    }
    return result;
  }
  return '[UNSERIALIZABLE]';
}
