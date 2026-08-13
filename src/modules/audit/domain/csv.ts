export const AUDIT_CSV_HEADER =
  'id,action,actor_id,target_type,target_id,is_sensitive,before,after,reason,created_at';

/** RFC-4180 style escape: wrap in double-quotes, double internal quotes; null → ''. */
export function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  return '"' + String(v).replace(/"/g, '""') + '"';
}

/** Serialize a jsonb value for CSV: '' when null, otherwise JSON string. */
export function jsonbField(v: unknown): string {
  if (v === null || v === undefined) return '';
  return JSON.stringify(v);
}
