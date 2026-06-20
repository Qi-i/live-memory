create table if not exists public.echo_passkey_records (
  owner_key text not null,
  id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (owner_key, id),
  constraint echo_passkey_records_owner_key_format
    check (owner_key ~ '^[a-f0-9]{64}$')
);

create table if not exists public.echo_passkey_media_assets (
  owner_key text not null,
  id text not null,
  record_id text not null,
  kind text not null,
  storage_path text,
  external_url text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (owner_key, id),
  foreign key (owner_key, record_id)
    references public.echo_passkey_records(owner_key, id)
    on delete cascade,
  constraint echo_passkey_media_owner_key_format
    check (owner_key ~ '^[a-f0-9]{64}$')
);

create index if not exists echo_passkey_records_owner_updated_idx
  on public.echo_passkey_records (owner_key, updated_at desc);

create index if not exists echo_passkey_media_record_idx
  on public.echo_passkey_media_assets (owner_key, record_id, updated_at desc);

insert into storage.buckets (id, name, public)
values ('echo-media', 'echo-media', false)
on conflict (id) do nothing;

create or replace function public.live_memory_owner_key()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-live-memory-owner-key', '')
$$;

alter table public.echo_passkey_records enable row level security;
alter table public.echo_passkey_media_assets enable row level security;

grant usage on schema public to anon, authenticated;
grant execute on function public.live_memory_owner_key() to anon, authenticated;
grant select, insert, update, delete on table public.echo_passkey_records to anon, authenticated;
grant select, insert, update, delete on table public.echo_passkey_media_assets to anon, authenticated;

do $$
begin
  if to_regclass('public.echo_records') is not null then
    grant select, insert, update, delete on table public.echo_records to authenticated;
  end if;
  if to_regclass('public.echo_media_assets') is not null then
    grant select, insert, update, delete on table public.echo_media_assets to authenticated;
  end if;
  if to_regclass('public.echo_user_profiles') is not null then
    grant select, insert, update, delete on table public.echo_user_profiles to authenticated;
  end if;
  if to_regclass('public.echo_text_backups') is not null then
    grant select, insert, update, delete on table public.echo_text_backups to authenticated;
  end if;
end $$;

drop policy if exists "echo passkey records owner read" on public.echo_passkey_records;
drop policy if exists "echo passkey records owner insert" on public.echo_passkey_records;
drop policy if exists "echo passkey records owner update" on public.echo_passkey_records;
drop policy if exists "echo passkey records owner delete" on public.echo_passkey_records;

create policy "echo passkey records owner read"
on public.echo_passkey_records for select
to anon, authenticated
using (owner_key = public.live_memory_owner_key());

create policy "echo passkey records owner insert"
on public.echo_passkey_records for insert
to anon, authenticated
with check (owner_key = public.live_memory_owner_key());

create policy "echo passkey records owner update"
on public.echo_passkey_records for update
to anon, authenticated
using (owner_key = public.live_memory_owner_key())
with check (owner_key = public.live_memory_owner_key());

create policy "echo passkey records owner delete"
on public.echo_passkey_records for delete
to anon, authenticated
using (owner_key = public.live_memory_owner_key());

drop policy if exists "echo passkey media owner read" on public.echo_passkey_media_assets;
drop policy if exists "echo passkey media owner insert" on public.echo_passkey_media_assets;
drop policy if exists "echo passkey media owner update" on public.echo_passkey_media_assets;
drop policy if exists "echo passkey media owner delete" on public.echo_passkey_media_assets;

create policy "echo passkey media owner read"
on public.echo_passkey_media_assets for select
to anon, authenticated
using (owner_key = public.live_memory_owner_key());

create policy "echo passkey media owner insert"
on public.echo_passkey_media_assets for insert
to anon, authenticated
with check (owner_key = public.live_memory_owner_key());

create policy "echo passkey media owner update"
on public.echo_passkey_media_assets for update
to anon, authenticated
using (owner_key = public.live_memory_owner_key())
with check (owner_key = public.live_memory_owner_key());

create policy "echo passkey media owner delete"
on public.echo_passkey_media_assets for delete
to anon, authenticated
using (owner_key = public.live_memory_owner_key());

drop policy if exists "echo passkey storage owner read" on storage.objects;
drop policy if exists "echo passkey storage owner insert" on storage.objects;
drop policy if exists "echo passkey storage owner update" on storage.objects;
drop policy if exists "echo passkey storage owner delete" on storage.objects;

create policy "echo passkey storage owner read"
on storage.objects for select
to anon, authenticated
using (
  bucket_id = 'echo-media'
  and (storage.foldername(name))[1] = public.live_memory_owner_key()
);

create policy "echo passkey storage owner insert"
on storage.objects for insert
to anon, authenticated
with check (
  bucket_id = 'echo-media'
  and (storage.foldername(name))[1] = public.live_memory_owner_key()
);

create policy "echo passkey storage owner update"
on storage.objects for update
to anon, authenticated
using (
  bucket_id = 'echo-media'
  and (storage.foldername(name))[1] = public.live_memory_owner_key()
)
with check (
  bucket_id = 'echo-media'
  and (storage.foldername(name))[1] = public.live_memory_owner_key()
);

create policy "echo passkey storage owner delete"
on storage.objects for delete
to anon, authenticated
using (
  bucket_id = 'echo-media'
  and (storage.foldername(name))[1] = public.live_memory_owner_key()
);

comment on table public.echo_passkey_records is
  'Private Live Memory records addressed by a browser-generated sync key.';
comment on table public.echo_passkey_media_assets is
  'Private Live Memory media index addressed by the same sync key as echo_passkey_records.';
