'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
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
  Plus,
  type LucideIcon,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';

// Client-only navigation command palette (Phase-UI-6, 6A). It ONLY navigates to routes
// the user is already entitled to — it never mutates state and never imports server-only
// modules (`permissions` arrives via props from app/(app)/layout.tsx; boundary test #4).
type PaletteItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  // When set, the item is shown only if the DB-derived permission set (AD1) includes it;
  // unset items are always visible. Mirrors the sidebar gating in app-nav.tsx.
  permission?: string;
  // Extra search terms so e.g. "prim" also surfaces "Bonus Dönemleri".
  keywords?: string[];
};

// Kept intentionally in sync with the sidebar's SECTIONS (app-nav.tsx): same routes, same
// permission gates. The palette is a flat search surface, so section grouping is dropped
// but the permission strings are identical — no route/permission is introduced here.
const PAGES: PaletteItem[] = [
  { label: 'Pano', href: '/dashboard', icon: LayoutDashboard, keywords: ['dashboard', 'ana sayfa', 'genel'] },
  { label: 'Görevler', href: '/tasks', icon: ClipboardList, permission: 'task.submit', keywords: ['task', 'is'] },
  { label: 'İnceleme Kuyruğu', href: '/tasks', icon: ClipboardCheck, permission: 'task.review', keywords: ['review', 'onay', 'inceleme'] },
  { label: 'Puanlarım', href: '/points', icon: Star, keywords: ['points', 'puan'] },
  { label: 'Liderlik Tablosu', href: '/leaderboard', icon: Trophy, keywords: ['leaderboard', 'siralama'] },
  { label: 'Bonus Dönemleri', href: '/bonus/periods', icon: CalendarRange, permission: 'period.manage', keywords: ['bonus', 'prim', 'donem', 'period'] },
  { label: 'İtirazlar', href: '/disputes', icon: MessageSquareWarning, permission: 'dispute.open', keywords: ['dispute', 'itiraz'] },
  { label: 'Ödeme Export', href: '/payroll/exports', icon: Download, permission: 'payout.export', keywords: ['payout', 'export', 'odeme'] },
  { label: 'Puan Override', href: '/points/override', icon: SlidersHorizontal, permission: 'point.override', keywords: ['override', 'duzeltme'] },
  { label: 'Anti-Gaming', href: '/anti-gaming', icon: ShieldAlert, permission: 'period.manage', keywords: ['anti gaming', 'kural', 'flag'] },
  { label: 'Denetim Kaydı', href: '/audit', icon: ScrollText, permission: 'audit.read', keywords: ['audit', 'denetim', 'log'] },
  { label: 'Üyeler', href: '/admin/members', icon: Users, permission: 'user.invite', keywords: ['members', 'uye', 'davet'] },
  { label: 'Destek Erişimi', href: '/admin/support-access', icon: Headphones, permission: 'support.grant', keywords: ['support', 'destek', 'erisim'] },
  { label: 'Profil', href: '/settings/profile', icon: UserCircle, keywords: ['profile', 'ayar', 'hesap'] },
];

// Quick-create style actions. These only navigate to an existing entitled route (no
// mutation from the palette). Each carries the same permission gate as its page so a user
// who cannot reach the page never sees the action.
const ACTIONS: PaletteItem[] = [
  { label: 'Görev oluştur', href: '/tasks', icon: Plus, permission: 'task.submit', keywords: ['yeni gorev', 'create task', 'ekle'] },
  { label: 'İtiraz aç', href: '/disputes', icon: Plus, permission: 'dispute.open', keywords: ['yeni itiraz', 'open dispute'] },
];

function useVisible(items: PaletteItem[], permissions: string[]): PaletteItem[] {
  return React.useMemo(
    () => items.filter((item) => !item.permission || permissions.includes(item.permission)),
    [items, permissions],
  );
}

export function CommandPalette({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  // Global Cmd/Ctrl+K toggle (6A).
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const pages = useVisible(PAGES, permissions);
  const actions = useVisible(ACTIONS, permissions);

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Sayfa veya eylem ara…" />
      <CommandList>
        <CommandEmpty>Sonuç bulunamadı.</CommandEmpty>

        {pages.length > 0 ? (
          <CommandGroup heading="Sayfalar">
            {pages.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={`page:${item.href}:${item.label}`}
                  value={`${item.label} ${(item.keywords ?? []).join(' ')}`}
                  onSelect={() => go(item.href)}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {pages.length > 0 && actions.length > 0 ? <CommandSeparator /> : null}

        {actions.length > 0 ? (
          <CommandGroup heading="Eylemler">
            {actions.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={`action:${item.href}:${item.label}`}
                  value={`${item.label} ${(item.keywords ?? []).join(' ')}`}
                  onSelect={() => go(item.href)}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
