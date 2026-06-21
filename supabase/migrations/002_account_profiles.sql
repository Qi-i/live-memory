create table if not exists public.echo_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  github_username text,
  github_user_id text,
  linked_supabase_url text,
  linked_supabase_anon_key text,
  linked_supabase_media_bucket text not null default 'echo-media',
  amap_key text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.echo_user_profiles is
  'Private per-user account profile and client-side service bindings for Echo Archive.';
comment on column public.echo_user_profiles.linked_supabase_anon_key is
  'Browser publishable/anon key only. Never store service_role, database passwords, or object storage secrets here.';
comment on column public.echo_user_profiles.preferences is
  'Private per-user display, map, backup and sync preferences restored after Live Memory login.';

alter table public.echo_user_profiles enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.echo_user_profiles to authenticated;

drop policy if exists "echo profile owner read" on public.echo_user_profiles;
drop policy if exists "echo profile owner insert" on public.echo_user_profiles;
drop policy if exists "echo profile owner update" on public.echo_user_profiles;
drop policy if exists "echo profile owner delete" on public.echo_user_profiles;

create policy "echo profile owner read"
on public.echo_user_profiles for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "echo profile owner insert"
on public.echo_user_profiles for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "echo profile owner update"
on public.echo_user_profiles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "echo profile owner delete"
on public.echo_user_profiles for delete
to authenticated
using ((select auth.uid()) = user_id);
