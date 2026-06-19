create table if not exists public.echo_records (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.echo_media_assets (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id text not null,
  kind text not null,
  storage_path text,
  external_url text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

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
using (auth.uid() = user_id);

create policy "echo records owner insert"
on public.echo_records for insert
to authenticated
with check (auth.uid() = user_id);

create policy "echo records owner update"
on public.echo_records for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "echo records owner delete"
on public.echo_records for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "echo media owner read" on public.echo_media_assets;
drop policy if exists "echo media owner insert" on public.echo_media_assets;
drop policy if exists "echo media owner update" on public.echo_media_assets;
drop policy if exists "echo media owner delete" on public.echo_media_assets;

create policy "echo media owner read"
on public.echo_media_assets for select
to authenticated
using (auth.uid() = user_id);

create policy "echo media owner insert"
on public.echo_media_assets for insert
to authenticated
with check (auth.uid() = user_id);

create policy "echo media owner update"
on public.echo_media_assets for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "echo media owner delete"
on public.echo_media_assets for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "echo media storage owner read" on storage.objects;
drop policy if exists "echo media storage owner insert" on storage.objects;
drop policy if exists "echo media storage owner update" on storage.objects;
drop policy if exists "echo media storage owner delete" on storage.objects;

create policy "echo media storage owner read"
on storage.objects for select
to authenticated
using (bucket_id = 'echo-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "echo media storage owner insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'echo-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "echo media storage owner update"
on storage.objects for update
to authenticated
using (bucket_id = 'echo-media' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'echo-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "echo media storage owner delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'echo-media' and (storage.foldername(name))[1] = auth.uid()::text);
