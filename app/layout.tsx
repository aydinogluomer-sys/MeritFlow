import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'MeritFlow',
  description:
    'Şeffaf görev takibi → puan → dönemsel prim. Açıklanabilir, denetlenebilir, adil.',
};

// UI language is Turkish (Decision Lock D8); i18n infrastructure is left open for V1.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
