-- Ephemeral PostgreSQL CI fixture. Recreates the EXISTING V2 base tables,
-- then executes the exact same V3 migrations used in the production project.
-- Never duplicate or reimplement the V3 CAS RPC in a test fixture.
create role anon nologin;
create role authenticated nologin;
create schema auth;

create function auth.uid()
returns uuid language sql stable set search_path = pg_catalog
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create function public.live_memory_owner_key()
returns text language sql stable security invoker set search_path = pg_catalog
as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-live-memory-owner-key','');
$$;

create table public.echo_passkey_records (
  owner_key text not null check (owner_key ~ '^[a-f0-9]{64}$'),
  id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (owner_key, id)
);

create table public.echo_text_backups (
  user_id uuid not null,
  id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

alter table public.echo_passkey_records enable row level security;
alter table public.echo_text_backups enable row level security;

create policy v2_passkey_owner on public.echo_passkey_records
for all to anon, authenticated
using (owner_key = public.live_memory_owner_key())
with check (owner_key = public.live_memory_owner_key());

create policy v2_account_owner on public.echo_text_backups
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant usage on schema public to anon, authenticated;
grant usage on schema auth to authenticated;
grant execute on function public.live_memory_owner_key() to anon, authenticated;
grant execute on function auth.uid() to authenticated;
grant select, insert, update on public.echo_passkey_records to anon, authenticated;
grant select, insert, update on public.echo_text_backups to authenticated;

-- Minimal Storage metadata tables for applying the exact new bucket
-- migration in an isolated PostgreSQL service with real RLS.
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id bigint generated always as identity primary key,
  bucket_id text not null references storage.buckets(id),
  name text not null,
  unique (bucket_id, name)
);
create function storage.foldername(path text) returns text[]
language sql immutable set search_path = pg_catalog
as $fn$select string_to_array(regexp_replace(path, '/[^/]+$', ''), '/')$fn$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert on storage.objects to anon, authenticated;
grant usage, select on sequence storage.objects_id_seq to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;

-- These lines are the only source of V3 SQL behavior in the test database.
\ir ../../supabase/migrations/015_v3_cas_revision.sql
\ir ../../supabase/migrations/016_v3_account_media_guard.sql
\ir ../../supabase/migrations/017_v3_private_media_bucket.sql
