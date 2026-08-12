import Link from 'next/link';
import { ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// Friendly, leak-free 403 (no data, no reason detail).
export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <ShieldOff className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold">Erişim yok</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Bu sayfaya erişmek için gerekli yetkiniz yok.
          </p>
          <Button asChild variant="outline">
            <Link href="/dashboard">Panoya dön</Link>
          </Button>
          <p className="text-xs text-muted-foreground">Yöneticinizle iletişime geçin.</p>
        </CardContent>
      </Card>
    </main>
  );
}
