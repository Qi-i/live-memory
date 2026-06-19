create table if not exists public.echo_records (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.echo_media_assets (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id text not null,
  kind text not null,
  storage_path text,
  external_url text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  foreign key (user_id, record_id)
    references public.echo_records(user_id, id)
    on delete cascade
);

create index if not exists echo_records_user_updated_idx
  on public.echo_records (user_id, updated_at desc);

create index if not exists echo_media_record_idx
  on public.echo_media_assets (user_id, record_id, updated_at desc);

insert into storage.buckets (id, name, public)
values ('echo-media', 'echo-media', false)
on conflict (id) do nothing;

alter table public.echo_records enable row level security;
alter table public.echo_media_assets enable row level security;

drop policy if exists "echo records owner read" on public.echo_records;
drop policy if exists "echo records owner insert" on public.echo_records;
drop policy if exists "echo records owner update" on public.echo_records;
drop policy if exists "echo records owner delete" on public.echo_records;

create policy "echo records owner read"
on public.echo_records for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "echo records owner insert"
on public.echo_records for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "echo records owner update"
on public.echo_records for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "echo records owner delete"
on public.echo_records for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "echo media owner read" on public.echo_media_assets;
drop policy if exists "echo media owner insert" on public.echo_media_assets;
drop policy if exists "echo media owner update" on public.echo_media_assets;
drop policy if exists "echo media owner delete" on public.echo_media_assets;

create policy "echo media owner read"
on public.echo_media_assets for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "echo media owner insert"
on public.echo_media_assets for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "echo media owner update"
on public.echo_media_assets for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "echo media owner delete"
on public.echo_media_assets for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "echo media storage owner read" on storage.objects;
drop policy if exists "echo media storage owner insert" on storage.objects;
drop policy if exists "echo media storage owner update" on storage.objects;
drop policy if exists "echo media storage owner delete" on storage.objects;

create policy "echo media storage owner read"
on storage.objects for select
to authenticated
using (bucket_id = 'echo-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "echo media storage owner insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'echo-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "echo media storage owner update"
on storage.objects for update
to authenticated
using (bucket_id = 'echo-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'echo-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "echo media storage owner delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'echo-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
