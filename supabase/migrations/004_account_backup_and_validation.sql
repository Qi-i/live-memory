create table if not exists public.echo_text_backups (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create index if not exists echo_text_backups_user_updated_idx
  on public.echo_text_backups (user_id, updated_at desc);

alter table public.echo_text_backups enable row level security;

drop policy if exists "echo text backup owner read" on public.echo_text_backups;
drop policy if exists "echo text backup owner insert" on public.echo_text_backups;
drop policy if exists "echo text backup owner update" on public.echo_text_backups;
drop policy if exists "echo text backup owner delete" on public.echo_text_backups;

create policy "echo text backup owner read"
on public.echo_text_backups for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "echo text backup owner insert"
on public.echo_text_backups for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "echo text backup owner update"
on public.echo_text_backups for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "echo text backup owner delete"
on public.echo_text_backups for delete
to authenticated
using ((select auth.uid()) = user_id);

alter table public.echo_user_profiles
  drop constraint if exists echo_user_profiles_username_format;

alter table public.echo_user_profiles
  add constraint echo_user_profiles_username_format
  check (username is null or username = '' or username ~ '^[a-z0-9]{4,32}$')
  not valid;

comment on table public.echo_text_backups is
  'Private text-only record backups for Live Memory accounts. Image bodies are intentionally excluded.';
comment on column public.echo_user_profiles.avatar_url is
  'Optional compressed avatar image or private image reference used by the account owner.';
