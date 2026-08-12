'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  message: string;
  icon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Presentational error state (mandated error states). Leak-free: render a short,
 * human message — never a raw stack or DB detail — for failed queries/actions.
 * A soft fade-in is applied via {@link AnimatePresence} (respects reduced motion).
 */
export function ErrorState({ message, icon, className, children }: ErrorStateProps) {
  return (
    <AnimatePresence>
      <motion.div
        role="alert"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-10 text-center',
          className,
        )}
      >
        {icon ? <div className="text-destructive">{icon}</div> : null}
        <p className="text-sm font-medium text-destructive">{message}</p>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
