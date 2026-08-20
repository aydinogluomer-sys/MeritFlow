import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { ThemeProvider } from 'next-themes';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'MeritFlow',
  description:
    'Şeffaf görev takibi → puan → dönemsel prim. Açıklanabilir, denetlenebilir, adil.',
};

// UI language is Turkish (Decision Lock D8); i18n infrastructure is left open for V1.
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // ENGINEERING-19 (8.3): read the per-request CSP nonce (set in proxy.ts). The nonce attribute on
  // <html> is a no-op at runtime today but is the ready hook for any future inline <Script> tags.
  const nonce = (await headers()).get('x-nonce') ?? '';
  return (
    <html lang="tr" suppressHydrationWarning nonce={nonce}>
      <body
        className={`${inter.variable} min-h-screen bg-background text-foreground antialiased`}
      >
        {/* next-themes toggles the `.dark` class on <html> (attribute="class"); the
            `.dark { … }` token block in globals.css supplies the dark palette. `<html>`
            carries suppressHydrationWarning (above) for the class the provider injects
            pre-hydration. NuqsAdapter stays the URL-state boundary around the app tree;
            the Toaster lives inside the provider so toasts pick up the theme too. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NuqsAdapter>{children}</NuqsAdapter>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
