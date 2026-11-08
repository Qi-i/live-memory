-- V3 CAS contract fixture for EPHEMERAL PostgreSQL CI only.
-- Not a production migration. Never apply this file to an existing Supabase project.
-- The fixture intentionally mirrors the ownership and table key layout of V2.

create role anon nologin;
create role authenticated nologin;
create schema auth;

create function auth.uid() returns uuid language sql stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create function public.live_memory_owner_key()
returns text language sql stable security invoker
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-live-memory-owner-key',
    ''
  );
$$;

create table public.echo_passkey_records (
  owner_key text not null check (owner_key ~ '^[a-f0-9]{64}$'),
  id text not null,
  payload jsonb not null default '{}'::jsonb,
  v3_revision bigint not null default 1 check (v3_revision >= 1),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (owner_key, id)
);

create table public.echo_text_backups (
  user_id uuid not null,
  id text not null,
  payload jsonb not null default '{}'::jsonb,
  v3_revision bigint not null default 1 check (v3_revision >= 1),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create function public.v3_record_revision_bump()
returns trigger language plpgsql security invoker
set search_path = pg_catalog
as $$
begin
  if old.v3_revision >= 9223372036854775807 then
    raise exception 'V3_REVISION_OVERFLOW';
  end if;
  new.v3_revision := old.v3_revision + 1;
  return new;
end;
$$;

-- The trigger also protects legacy V2 UPDATE/upsert paths, not only the new RPC.
create trigger passkey_revision_bump before update on public.echo_passkey_records
for each row execute function public.v3_record_revision_bump();
create trigger account_revision_bump before update on public.echo_text_backups
for each row execute function public.v3_record_revision_bump();

alter table public.echo_passkey_records enable row level security;
alter table public.echo_text_backups enable row level security;

create policy v3_passkey_owner on public.echo_passkey_records
for all to anon, authenticated
using (owner_key = (select public.live_memory_owner_key()))
with check (owner_key = (select public.live_memory_owner_key()));

create policy v3_account_owner on public.echo_text_backups
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

grant usage on schema public to anon, authenticated;
grant usage on schema auth to authenticated;
grant execute on function public.live_memory_owner_key() to anon, authenticated;
grant execute on function auth.uid() to authenticated;
grant select, insert, update on public.echo_passkey_records to anon, authenticated;
grant select, insert, update on public.echo_text_backups to authenticated;

create function public.live_memory_v3_cas_personal(
  p_id text, p_payload jsonb, p_expected_revision bigint
) returns table(id text,payload jsonb,v3_revision bigint)
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_owner text;
  v_saved record;
begin
  v_owner := public.live_memory_owner_key();
  if v_owner !~ '^[a-f0-9]{64}$' or p_id is null or btrim(p_id) = '' then
    raise exception 'V3_OWNER_NOT_AUTHORIZED';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_payload->>'id' is distinct from p_id then
    raise exception 'V3_INVALID_RECORD';
  end if;
  if p_expected_revision is null then
    insert into public.echo_passkey_records as r(owner_key,id,payload,deleted_at)
    values (v_owner,p_id,p_payload,nullif(p_payload->>'deletedAt','')::timestamptz)
    on conflict (owner_key,id) do nothing
    returning r.id,r.payload,r.v3_revision into v_saved;
  else
    if p_expected_revision < 1 then raise exception 'V3_INVALID_REVISION'; end if;
    update public.echo_passkey_records as r
    set payload = p_payload,
        deleted_at = nullif(p_payload->>'deletedAt','')::timestamptz,
        updated_at = clock_timestamp()
    where r.owner_key = v_owner and r.id = p_id and r.v3_revision = p_expected_revision
    returning r.id,r.payload,r.v3_revision into v_saved;
  end if;
  if v_saved.id is null then raise exception 'V3_REVISION_CONFLICT'; end if;
  return query select v_saved.id::text, v_saved.payload::jsonb, v_saved.v3_revision::bigint;
end;
$$;

create function public.live_memory_v3_cas_account(
  p_id text, p_payload jsonb, p_expected_revision bigint
) returns table(id text,payload jsonb,v3_revision bigint)
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_saved record;
begin
  v_uid := auth.uid();
  if v_uid is null or p_id is null or btrim(p_id) = '' then
    raise exception 'V3_OWNER_NOT_AUTHORIZED';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_payload->>'id' is distinct from p_id then
    raise exception 'V3_INVALID_RECORD';
  end if;
  -- The database must not trust the client to suppress ticket scans/media.
  if p_payload ? 'media' and p_payload->'media' <> '[]'::jsonb then
    raise exception 'V3_ACCOUNT_MEDIA_FORBIDDEN';
  end if;
  if p_payload ? 'mediaTombstones' and p_payload->'mediaTombstones' <> 'null'::jsonb
     and p_payload->'mediaTombstones' <> '[]'::jsonb then
    raise exception 'V3_ACCOUNT_MEDIA_FORBIDDEN';
  end if;
  if p_expected_revision is null then
    insert into public.echo_text_backups as r(user_id,id,payload,deleted_at)
    values (v_uid,p_id,p_payload,nullif(p_payload->>'deletedAt','')::timestamptz)
    on conflict (user_id,id) do nothing
    returning r.id,r.payload,r.v3_revision into v_saved;
  else
    if p_expected_revision < 1 then raise exception 'V3_INVALID_REVISION'; end if;
    update public.echo_text_backups as r
    set payload = p_payload,
        deleted_at = nullif(p_payload->>'deletedAt','')::timestamptz,
        updated_at = clock_timestamp()
    where r.user_id = v_uid and r.id = p_id and r.v3_revision = p_expected_revision
    returning r.id,r.payload,r.v3_revision into v_saved;
  end if;
  if v_saved.id is null then raise exception 'V3_REVISION_CONFLICT'; end if;
  return query select v_saved.id::text, v_saved.payload::jsonb, v_saved.v3_revision::bigint;
end;
$$;

revoke all on function public.live_memory_v3_cas_personal(text,jsonb,bigint) from public;
revoke all on function public.live_memory_v3_cas_account(text,jsonb,bigint) from public;
grant execute on function public.live_memory_v3_cas_personal(text,jsonb,bigint) to anon,authenticated;
grant execute on function public.live_memory_v3_cas_account(text,jsonb,bigint) to authenticated;
