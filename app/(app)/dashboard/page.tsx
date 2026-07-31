import { getUser } from '@/lib/auth/session';
import { getActiveOrg } from '@/lib/auth/org';
import { getPermissions } from '@/lib/auth/rbac';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default async function DashboardPage() {
  const user = await getUser();
  const org = await getActiveOrg();
  const permissions = await getPermissions();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Pano</h1>
        <p className="text-sm text-muted-foreground">
          Hoş geldin{user?.email ? `, ${user.email}` : ''}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bağlam</CardTitle>
          <CardDescription>
            Aktif organizasyon ve yetkilerin — DB kaynaklı, JWT claim değil (AD1).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div>
            Organizasyon: <span className="font-mono">{org?.organization_id ?? '—'}</span>
          </div>
          <div>
            Rol: <span className="font-medium">{org?.primary_role ?? '—'}</span>
          </div>
          <div>Yetki sayısı: {permissions.length}</div>
        </CardContent>
      </Card>
    </div>
  );
}
