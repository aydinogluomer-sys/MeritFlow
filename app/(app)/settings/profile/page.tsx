'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { updateProfile } from '@/app/actions/settings/update-profile';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ProfileSettingsPage() {
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .single();
      if (data?.display_name) setDisplayName(data.display_name);
      setLoading(false);
    }
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const result = await updateProfile({ displayName });

    if (result.ok) {
      setMessage({ type: 'success', text: 'Profil güncellendi.' });
      toast.success('Profil güncellendi.');
    } else {
      setMessage({ type: 'error', text: result.error ?? 'Bir hata oluştu.' });
      toast.error(result.error ?? 'Profil güncellenemedi.');
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Profil Ayarları</h1>
        <p className="text-sm text-muted-foreground">Görünen adınızı güncelleyin.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profil</CardTitle>
          <CardDescription>Kimlik bilgileri yalnızca sizin verilerinizdir.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor="displayName">Görünen Ad</Label>
                <Input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  maxLength={100}
                />
              </div>

              {message && (
                <p
                  className={
                    message.type === 'success'
                      ? 'text-sm text-green-600'
                      : 'text-sm text-destructive'
                  }
                >
                  {message.text}
                </p>
              )}

              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
