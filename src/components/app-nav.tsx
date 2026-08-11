import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';

type NavItem = { label: string; href: string; permission?: string };

const LINK_CLASS =
  'rounded-md px-3 py-2 font-medium hover:bg-accent hover:text-accent-foreground';

// Role-based IA (doc 09). Every item now has a live route (<Link>). Items with a
// `permission` are shown only when the DB-derived permission set (AD1) includes it;
// items without a permission are always visible.
const SECTIONS: NavItem[] = [
  // Employee-facing (task.submit)
  { label: 'Görevler', href: '/tasks', permission: 'task.submit' },
  // Reviewer-facing (task.review) — same route, different gate (intended).
  { label: 'İnceleme Kuyruğu', href: '/tasks', permission: 'task.review' },
  // Always visible
  { label: 'Puanlarım', href: '/points' },
  { label: 'Liderlik Tablosu', href: '/leaderboard' },
  // Manager / HR / Finance / Auditor
  { label: 'Bonus Dönemleri', href: '/bonus/periods', permission: 'period.manage' },
  { label: 'İtirazlar', href: '/disputes', permission: 'dispute.open' },
  { label: 'Ödeme Export', href: '/payroll/exports', permission: 'payout.export' },
  { label: 'Puan Override', href: '/points/override', permission: 'point.override' },
  { label: 'Anti-Gaming', href: '/anti-gaming', permission: 'period.manage' },
  { label: 'Denetim Kaydı', href: '/audit', permission: 'audit.read' },
  { label: 'Üyeler', href: '/admin/members', permission: 'user.invite' },
  { label: 'Destek Erişimi', href: '/admin/support-access', permission: 'support.grant' },
  // Always visible — self-service identity; no permission gate needed (any member)
  { label: 'Profil', href: '/settings/profile' },
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
          className={LINK_CLASS}
        >
          Pano
        </Link>
        {visible.map((section) => (
          <Link
            key={`${section.href}:${section.label}`}
            href={section.href}
            className={LINK_CLASS}
          >
            {section.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto">
        <SignOutButton />
      </div>
    </aside>
  );
}
