'use client';

import type * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * Client hover-elevation wrapper for cards rendered inside server components
 * (e.g. the dashboard KPI cards). Lifts ~2px with a soft primary-tinted shadow
 * on hover (Phase-UI-5c). The card's own entry animation (animate-slide-up) stays
 * on the inner <Card> — kept on a separate element so the CSS keyframe transform
 * and this hover transform never fight. Honors prefers-reduced-motion.
 */
export function MotionCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={cn('h-full', className)}
      whileHover={
        reduce ? undefined : { y: -2, boxShadow: '0 8px 24px hsl(var(--primary) / 0.08)' }
      }
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
