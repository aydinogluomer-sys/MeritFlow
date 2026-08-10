-- =============================================================================
-- Migration 0032 — Privacy-first leaderboard RPC  (Phase post-10-C)
-- Refs: Decision Lock AD5 (collaboration score does not affect ranking here;
--       privacy-first: caller sees own name, others anonymised).
--       Local dev only — never production (per CLAUDE.md MCP rules).
-- =============================================================================

create function public.get_leaderboard(
  p_organization_id uuid,
  p_period_start    date default null,
  p_period_end      date default null
)
returns table (
  rank         bigint,
  display_name text,
  total_points numeric,
  is_self      boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  with ranked as (
    select
      pl.employee_id,
      sum(pl.points_delta) as total_points,
      rank() over (order by sum(pl.points_delta) desc) as rank
    from public.point_ledger pl
    where pl.organization_id = p_organization_id
      and (p_period_start is null or pl.created_at::date >= p_period_start)
      and (p_period_end   is null or pl.created_at::date <= p_period_end)
      and pl.event_type in ('task_approved', 'dispute_adjustment', 'manual_adjustment')
      and exists (
        select 1 from public.memberships m
        where m.profile_id      = auth.uid()
          and m.organization_id = p_organization_id
          and m.status          = 'active'
      )
    group by pl.employee_id
  )
  select
    r.rank,
    case
      when r.employee_id = auth.uid() then coalesce(p.display_name, 'Sen')
      else 'Çalışan #' || r.rank::text
    end as display_name,
    r.total_points,
    (r.employee_id = auth.uid()) as is_self
  from ranked r
  left join public.profiles p on p.id = r.employee_id
  order by r.rank;
$$;

comment on function public.get_leaderboard(uuid, date, date) is
  'Privacy-first leaderboard (AD5): caller sees own name, others anonymized.
   Net points = task_approved + dispute_adjustment + manual_adjustment.
   SECURITY DEFINER bypasses RLS to aggregate; cross-tenant blocked via memberships guard.';

revoke execute on function public.get_leaderboard(uuid, date, date) from public, anon;
grant execute on function public.get_leaderboard(uuid, date, date) to authenticated;
