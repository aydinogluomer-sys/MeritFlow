'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
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
 * A soft fade-in is applied via {@link AnimatePresence} (respects reduced motion).
 */
export function EmptyState({ message, icon, className, children }: EmptyStateProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center',
          className,
        )}
      >
        {icon ? <div className="text-muted-foreground">{icon}</div> : null}
        <p className="text-sm text-muted-foreground">{message}</p>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
