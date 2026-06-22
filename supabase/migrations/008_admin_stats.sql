-- 008_admin_stats.sql
-- Admin dashboard: aggregate stats, visitor tracking, storage breakdown.
-- All admin functions use SECURITY DEFINER to bypass RLS.

-- ============================================================
-- 1. Private schema for admin internals
-- ============================================================

create schema if not exists live_memory_private;
revoke all on schema live_memory_private from public, anon, authenticated;
grant usage on schema live_memory_private to anon, authenticated;

-- ============================================================
-- 2. Admin overview stats
-- ============================================================

create or replace function live_memory_private.admin_stats_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'total_users', (select count(*) from public.echo_user_profiles),
    'total_records', (select count(*) from public.echo_passkey_records where deleted_at is null),
    'total_media', (select count(*) from public.echo_passkey_media_assets where deleted_at is null),
    'active_users', (select count(distinct owner_key) from public.echo_passkey_records where deleted_at is null),
    'latest_users', coalesce(
      (select jsonb_agg(row_to_json(u))
       from (
         select username, display_name, created_at
         from public.echo_user_profiles
         order by created_at desc
         limit 5
       ) u),
      '[]'::jsonb
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.echo_admin_stats_overview()
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select live_memory_private.admin_stats_overview()
$$;

grant execute on function public.echo_admin_stats_overview() to anon, authenticated;

comment on function public.echo_admin_stats_overview() is
  'Returns platform-wide counts: users, records, media, active users, and 5 latest registrations.';

-- ============================================================
-- 3. Daily trends (new users + new records per day)
-- ============================================================

create or replace function live_memory_private.admin_stats_trends(p_days int default 30)
returns table(day date, new_users bigint, new_records bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with date_range as (
    select generate_series(
      current_date - (p_days - 1) * interval '1 day',
      current_date,
      interval '1 day'
    )::date as day
  ),
  user_counts as (
    select (created_at at time zone 'Asia/Shanghai')::date as day, count(*) as cnt
    from public.echo_user_profiles
    where created_at >= (current_date - (p_days - 1) * interval '1 day') at time zone 'Asia/Shanghai'
    group by 1
  ),
  record_counts as (
    select (updated_at at time zone 'Asia/Shanghai')::date as day, count(*) as cnt
    from public.echo_passkey_records
    where deleted_at is null
      and updated_at >= (current_date - (p_days - 1) * interval '1 day') at time zone 'Asia/Shanghai'
    group by 1
  )
  select d.day,
         coalesce(uc.cnt, 0)::bigint as new_users,
         coalesce(rc.cnt, 0)::bigint as new_records
  from date_range d
  left join user_counts uc on uc.day = d.day
  left join record_counts rc on rc.day = d.day
  order by d.day;
end;
$$;

create or replace function public.echo_admin_stats_trends(p_days int default 30)
returns table(day date, new_users bigint, new_records bigint)
language sql
security invoker
set search_path = public
as $$
  select * from live_memory_private.admin_stats_trends(p_days)
$$;

grant execute on function public.echo_admin_stats_trends(int) to anon, authenticated;

-- ============================================================
-- 4. Per-user storage breakdown
-- ============================================================

create or replace function live_memory_private.admin_storage_breakdown()
returns table(username text, display_name text, record_count bigint, media_count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    p.username,
    p.display_name,
    coalesce(r.cnt, 0)::bigint as record_count,
    coalesce(m.cnt, 0)::bigint as media_count
  from public.echo_user_profiles p
  left join (
    select owner_key, count(*) as cnt
    from public.echo_passkey_records
    where deleted_at is null
    group by owner_key
  ) r on r.owner_key = p.user_id::text
  left join (
    select ma.owner_key, count(*) as cnt
    from public.echo_passkey_media_assets ma
    join public.echo_passkey_records pr on pr.owner_key = ma.owner_key and pr.id = ma.record_id
    where ma.deleted_at is null
    group by ma.owner_key
  ) m on m.owner_key = p.user_id::text
  where coalesce(r.cnt, 0) > 0 or coalesce(m.cnt, 0) > 0
  order by (coalesce(r.cnt, 0) + coalesce(m.cnt, 0)) desc
  limit 20;
end;
$$;

create or replace function public.echo_admin_storage_breakdown()
returns table(username text, display_name text, record_count bigint, media_count bigint)
language sql
security invoker
set search_path = public
as $$
  select * from live_memory_private.admin_storage_breakdown()
$$;

grant execute on function public.echo_admin_storage_breakdown() to anon, authenticated;

-- ============================================================
-- 5. Page views table + recording function
-- ============================================================

create table if not exists public.echo_page_views (
  id bigserial primary key,
  path text not null,
  referrer text,
  user_agent text,
  viewed_at timestamptz not null default now()
);

create index if not exists idx_echo_page_views_viewed_at
  on public.echo_page_views (viewed_at);

comment on table public.echo_page_views is
  'Lightweight visitor tracking for the admin dashboard.';

revoke all on table public.echo_page_views from public, anon, authenticated;

create or replace function live_memory_private.record_page_view(
  p_path text,
  p_referrer text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.echo_page_views (path, referrer, user_agent)
  values (
    coalesce(left(p_path, 500), '/'),
    left(p_referrer, 1000),
    left(p_user_agent, 500)
  );
  -- Cleanup old views opportunistically (1% chance per call)
  if random() < 0.01 then
    delete from public.echo_page_views
    where viewed_at < now() - interval '90 days';
  end if;
end;
$$;

create or replace function public.echo_record_page_view(
  p_path text,
  p_referrer text default null,
  p_user_agent text default null
)
returns void
language sql
security invoker
set search_path = public
as $$
  select live_memory_private.record_page_view(p_path, p_referrer, p_user_agent)
$$;

grant execute on function public.echo_record_page_view(text, text, text) to anon, authenticated;

-- ============================================================
-- 6. Visitor stats query
-- ============================================================

create or replace function live_memory_private.admin_visitor_stats(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'total_views', (
      select count(*) from public.echo_page_views
      where viewed_at >= now() - (p_days || ' days')::interval
    ),
    'unique_paths', (
      select count(distinct path) from public.echo_page_views
      where viewed_at >= now() - (p_days || ' days')::interval
    ),
    'daily_views', coalesce(
      (select jsonb_agg(row_to_json(dv) order by dv.day)
       from (
         select (viewed_at at time zone 'Asia/Shanghai')::date as day, count(*)::bigint as count
         from public.echo_page_views
         where viewed_at >= now() - (p_days || ' days')::interval
         group by 1
       ) dv),
      '[]'::jsonb
    ),
    'top_paths', coalesce(
      (select jsonb_agg(row_to_json(tp))
       from (
         select path, count(*)::bigint as count
         from public.echo_page_views
         where viewed_at >= now() - (p_days || ' days')::interval
         group by path
         order by count desc
         limit 10
       ) tp),
      '[]'::jsonb
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.echo_admin_visitor_stats(p_days int default 30)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select live_memory_private.admin_visitor_stats(p_days)
$$;

grant execute on function public.echo_admin_visitor_stats(int) to anon, authenticated;
