-- Harden the owner-key helper so object lookup cannot be affected by a caller-controlled search_path.
create or replace function public.live_memory_owner_key()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-live-memory-owner-key',
    ''
  )
$$;

comment on function public.live_memory_owner_key() is
  'Returns the private Live Memory owner key from the request header using a fixed search_path.';
