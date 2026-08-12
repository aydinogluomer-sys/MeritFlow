'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) {
      toast.error('Giriş bağlantısı gönderilemedi. Lütfen tekrar deneyin.');
    } else {
      toast.success('Giriş bağlantısı e-posta adresine gönderildi.');
      setSent(true);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">MeritFlow</h1>
          <p className="text-sm text-muted-foreground">HR Performans Platformu</p>
        </div>

        <Card className="w-full shadow-lg">
          {sent ? (
            <>
              <CardHeader className="items-center text-center">
                <CheckCircle2
                  className="h-10 w-10 text-muted-foreground"
                  aria-hidden="true"
                />
                <CardTitle>E-postanızı kontrol edin</CardTitle>
                <CardDescription>
                  {email} adresine bir giriş bağlantısı gönderdik. Bağlantıya tıklayarak
                  giriş yapabilirsiniz.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
                  Farklı bir e-posta kullan
                </Button>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Giriş yap</CardTitle>
                <CardDescription>E-posta ile giriş bağlantısı al.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={onSubmit} className="flex flex-col gap-3">
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="ornek@sirket.com"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <Button type="submit" disabled={loading || !email}>
                    {loading ? 'Gönderiliyor…' : 'Giriş bağlantısı gönder'}
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
