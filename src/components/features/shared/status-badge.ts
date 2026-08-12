/**
 * Phase-UI-4·D — standardized status-badge colouring.
 *
 * Maps a raw status token to Tailwind classes for the {@link Badge} component. Callers
 * keep rendering `<Badge className={statusBadgeClass(status)}>{label}</Badge>`; tokens not
 * in the map fall back to the `outline` variant (returns `undefined` so the caller's
 * `variant="outline"` styling applies unchanged).
 */
const STATUS_BADGE_CLASSES: Record<string, string> = {
  // approved / active / accepted → emerald
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  // pending / submitted / open → amber
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  submitted: 'bg-amber-50 text-amber-700 border-amber-200',
  open: 'bg-amber-50 text-amber-700 border-amber-200',
  // rejected / cancelled / closed → red
  rejected: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
  closed: 'bg-red-50 text-red-700 border-red-200',
};

/**
 * Returns the standardized colour classes for a status token, or `undefined` for any token
 * outside the mapping (caller should render `<Badge variant="outline" ...>`).
 */
export function statusBadgeClass(status: string): string | undefined {
  return STATUS_BADGE_CLASSES[status];
}

/**
 * Whether a status token has a standardized colour. When `false`, callers render the
 * `outline` variant.
 */
export function hasStatusBadgeClass(status: string): boolean {
  return status in STATUS_BADGE_CLASSES;
}
