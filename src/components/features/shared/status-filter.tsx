'use client';

import { useQueryState } from 'nuqs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface StatusFilterOption {
  /** URL value written to `?status=`; the sentinel `'all'` clears the filter. */
  value: string;
  /** tr-TR label rendered on the segment. */
  label: string;
}

/**
 * Client-side segmented control that drives the `?status=` URL query param via nuqs.
 *
 * Deliberately a small client boundary: the pages that render it stay server components
 * (they keep their hasPermission / getActiveOrg gate + server-side data fetch and read
 * `status` from `searchParams`). This component only reflects/writes the URL — it holds no
 * data and imports nothing server-only, so it satisfies the admin/server-only boundary test.
 *
 * `defaultValue` (typically 'all') is the option treated as "no filter": selecting it clears
 * the param from the URL so the canonical listing URL has no query string.
 */
export function StatusFilter({
  options,
  defaultValue = 'all',
  ariaLabel = 'Durum filtresi',
}: {
  options: readonly StatusFilterOption[];
  defaultValue?: string;
  ariaLabel?: string;
}) {
  const [status, setStatus] = useQueryState('status', {
    defaultValue,
    clearOnDefault: true,
    // Filtering re-renders the server component with fresh searchParams; no client history spam.
    history: 'replace',
    shallow: false,
  });

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap gap-1 rounded-md border border-input bg-muted/40 p-1"
    >
      {options.map((option) => {
        const active = status === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={active ? 'default' : 'ghost'}
            aria-pressed={active}
            onClick={() => setStatus(option.value)}
            className={cn('h-7', !active && 'text-muted-foreground')}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
