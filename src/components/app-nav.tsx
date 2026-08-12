'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ClipboardList,
  ClipboardCheck,
  Star,
  Trophy,
  CalendarRange,
  MessageSquareWarning,
  Download,
  SlidersHorizontal,
  ShieldAlert,
  ScrollText,
  Users,
  Headphones,
  UserCircle,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { SignOutButton } from '@/components/sign-out-button';
import { cn } from '@/lib/utils';

type SectionKey = 'main' | 'employee' | 'management' | 'admin' | 'account';

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  section: SectionKey;
  permission?: string;
};

// Role-based IA (doc 09). Every item has a live route (<Link>) and an icon. Items with a
// `permission` are shown only when the DB-derived permission set (AD1) includes it; items
// without a permission are always visible. Items are grouped into sections; a whole section
// header is hidden when the user has no visible item within it (see `SECTION_ORDER` below).
const SECTIONS: NavItem[] = [
  // Always visible — landing/overview (no permission gate).
  { label: 'Pano', href: '/dashboard', icon: LayoutDashboard, section: 'main' },

  // ── Employee-facing ──────────────────────────────────────────────────────────
  // Employee-facing (task.submit)
  { label: 'Görevler', href: '/tasks', icon: ClipboardList, section: 'employee', permission: 'task.submit' },
  // Reviewer-facing (task.review) — same route, different gate (intended).
  { label: 'İnceleme Kuyruğu', href: '/tasks', icon: ClipboardCheck, section: 'employee', permission: 'task.review' },
  // Always visible
  { label: 'Puanlarım', href: '/points', icon: Star, section: 'employee' },
  { label: 'Liderlik Tablosu', href: '/leaderboard', icon: Trophy, section: 'employee' },

  // ── Management / HR / Finance ─────────────────────────────────────────────────
  { label: 'Bonus Dönemleri', href: '/bonus/periods', icon: CalendarRange, section: 'management', permission: 'period.manage' },
  { label: 'İtirazlar', href: '/disputes', icon: MessageSquareWarning, section: 'management', permission: 'dispute.open' },
  { label: 'Ödeme Export', href: '/payroll/exports', icon: Download, section: 'management', permission: 'payout.export' },
  { label: 'Puan Override', href: '/points/override', icon: SlidersHorizontal, section: 'management', permission: 'point.override' },
  { label: 'Anti-Gaming', href: '/anti-gaming', icon: ShieldAlert, section: 'management', permission: 'period.manage' },

  // ── Admin / Auditor ───────────────────────────────────────────────────────────
  { label: 'Denetim Kaydı', href: '/audit', icon: ScrollText, section: 'admin', permission: 'audit.read' },
  { label: 'Üyeler', href: '/admin/members', icon: Users, section: 'admin', permission: 'user.invite' },
  { label: 'Destek Erişimi', href: '/admin/support-access', icon: Headphones, section: 'admin', permission: 'support.grant' },

  // ── Account ───────────────────────────────────────────────────────────────────
  // Always visible — self-service identity; no permission gate needed (any member).
  { label: 'Profil', href: '/settings/profile', icon: UserCircle, section: 'account' },
];

// Section render order + uppercase Turkish headers. `main` has no header (top-level).
const SECTION_ORDER: { key: SectionKey; label: string | null }[] = [
  { key: 'main', label: null },
  { key: 'employee', label: 'Çalışan' },
  { key: 'management', label: 'Yönetim' },
  { key: 'admin', label: 'Yönetici' },
  { key: 'account', label: 'Hesap' },
];

// Turkish display labels for the org role badge (2D). Falls back to the raw role.
const ROLE_LABELS: Record<string, string> = {
  owner: 'Sahip',
  admin: 'Yönetici',
  hr: 'İK',
  finance: 'Finans',
  manager: 'Ekip Yöneticisi',
  employee: 'Çalışan',
  auditor: 'Denetçi',
};

/** First two letters of the display name (uppercased) for the avatar fallback. */
function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '??';
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * Active-link detection. Two items share `/tasks`; we mark active by prefix so both light
 * up on `/tasks*` — acceptable since they are the same route (the permission gate is what
 * distinguishes them). Exact match for the root-ish `/` guard is unnecessary here since no
 * href is `/`.
 */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav({
  permissions,
  orgRole,
  displayName,
  email,
  orgSlug,
}: {
  permissions: string[];
  orgRole: string | null;
  displayName: string;
  email: string;
  orgSlug: string | null;
}) {
  const pathname = usePathname();

  const visible = SECTIONS.filter(
    (item) => !item.permission || permissions.includes(item.permission),
  );

  const roleLabel = orgRole ? (ROLE_LABELS[orgRole] ?? orgRole) : null;
  const subtitle = orgSlug ?? 'HR Platform';

  return (
    <aside className="flex w-60 flex-col border-r bg-card">
      {/* Logo + org role badge (2D) */}
      <div className="flex items-start justify-between gap-2 p-4">
        <div className="min-w-0">
          <div className="font-bold tracking-tight">MeritFlow</div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
        {roleLabel ? (
          <Badge variant="secondary" className="shrink-0">
            {roleLabel}
          </Badge>
        ) : null}
      </div>

      <Separator />

      {/* Sectioned navigation (2B) */}
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3 text-sm">
        {SECTION_ORDER.map(({ key, label }) => {
          const items = visible.filter((item) => item.section === key);
          // Hide a whole section when the user has no visible item in it (2B).
          if (items.length === 0) return null;

          return (
            <div key={key} className="flex flex-col gap-1">
              {label ? (
                <div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
              ) : null}
              {items.map((item) => {
                const Icon = item.icon;
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={`${item.href}:${item.label}`}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-md border-l-2 border-transparent px-3 py-2 font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
                      active &&
                        'border-primary bg-accent font-semibold text-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <Separator />

      {/* Bottom profile block + sign-out (2E) */}
      <div className="mt-auto flex items-center gap-3 p-3">
        <Avatar className="h-9 w-9">
          <AvatarFallback className="text-xs font-semibold">
            {initials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{displayName}</div>
          <div className="truncate text-xs text-muted-foreground">{email}</div>
        </div>
        <SignOutButton variant="icon" />
      </div>
    </aside>
  );
}
