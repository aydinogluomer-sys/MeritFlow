import * as React from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  message: string;
  icon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Presentational empty state (mandated empty states). Renders a calm, centered
 * message for empty result sets, e.g. `<EmptyState message="Henüz görev yok" />`.
 */
export function EmptyState({ message, icon, className, children }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center',
        className,
      )}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="text-sm text-muted-foreground">{message}</p>
      {children}
    </div>
  );
}
