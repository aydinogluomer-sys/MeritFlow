import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';

type NavItem = { label: string; permission?: string };

// Placeholder role-based IA (doc 09). The real screens arrive in later phases; gated
// items render as "yakında" (soon) and are filtered by DB-derived permissions (AD1).
const SECTIONS: NavItem[] = [
  { label: 'İnceleme Kuyruğu', permission: 'task.review' },
  { label: 'Bonus Dönemleri', permission: 'period.manage' },
  { label: 'Ödeme Export', permission: 'payout.export' },
  { label: 'İtirazlar', permission: 'dispute.resolve' },
  { label: 'Denetim Kaydı', permission: 'audit.read' },
  { label: 'Ücret', permission: 'comp.read' },
];

export function AppNav({
  permissions,
  orgRole,
}: {
  permissions: string[];
  orgRole: string | null;
}) {
  const visible = SECTIONS.filter(
    (section) => !section.permission || permissions.includes(section.permission),
  );

  return (
    <aside className="flex w-60 flex-col gap-4 border-r bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold">MeritFlow</span>
        {orgRole ? <Badge variant="secondary">{orgRole}</Badge> : null}
      </div>
      <nav className="flex flex-col gap-1 text-sm">
        <Link
          href="/dashboard"
          className="rounded-md px-3 py-2 font-medium hover:bg-accent hover:text-accent-foreground"
        >
          Pano
        </Link>
        {visible.map((section) => (
          <span
            key={section.label}
            className="flex items-center justify-between rounded-md px-3 py-2 text-muted-foreground"
          >
            {section.label}
            <Badge variant="outline" className="text-[10px]">
              yakında
            </Badge>
          </span>
        ))}
      </nav>
      <div className="mt-auto">
        <SignOutButton />
      </div>
    </aside>
  );
}
