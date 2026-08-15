'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Render-time error boundary for the authenticated app shell. Catches synchronous render
 * errors thrown by child components and shows a calm, leak-free fallback (no stack, no data).
 *
 * This is NOT for financial mutations: Server Actions already return a typed ActionResult and
 * surface failures inline (see the *-form / *-button components) — this only guards unexpected
 * render failures so a single broken subtree does not blank the whole shell.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  private readonly handleReload = () => {
    // Full reload re-runs the server render — recovers from transient failures.
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center"
        >
          <h2 className="text-lg font-semibold">Beklenmedik bir hata oluştu</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Sayfayı yenileyin. Sorun sürerse yöneticinizle iletişime geçin.
          </p>
          <Button onClick={this.handleReload}>Sayfayı yenile</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
