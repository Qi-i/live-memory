-- Live Memory V3: irreversible owner-scoped writer cutover protocol.
-- ADDS no mode rows; all existing V2 users continue with their existing path.
-- A future explicit account cutover inserts a single owner-scoped marker.
-- After that marker is committed, old V2 direct upserts are rejected and
-- only the server-side CAS RPC may commit, closing the blind overwrite gap.
--
-- Safety: no existing user has been activated, no records are rewritten.

create table if not exists public.live_memory_v3_writer_modes (
  provider text not null check (provider in ('personal','account')),
  identity text not null,
  activated_at timestamptz not null default now(),
  primary key(provider,identity)
);
alter table public.live_memory_v3_writer_modes enable row level security;

create policy v3_writer_mode_read on public.live_memory_v3_writer_modes
for select to anon,authenticated
using (
  (provider='personal' and identity=public.live_memory_owner_key()
     and identity ~ '^[a-f0-9]{64}$')
  or (provider='account' and identity=(select auth.uid())::text)
);
create policy v3_writer_mode_activate on public.live_memory_v3_writer_modes
for insert to anon,authenticated
with check (
  (provider='personal' and identity=public.live_memory_owner_key()
     and identity ~ '^[a-f0-9]{64}$')
  or (provider='account' and identity=(select auth.uid())::text)
);
-- No direct UPDATE or DELETE privilege: no unsafe rollback to V2 after a
-- committed V3 write. Administrative recovery must audit both versions.
revoke all on public.live_memory_v3_writer_modes from public,anon,authenticated;
grant select,insert on public.live_memory_v3_writer_modes to anon,authenticated;

create or replace function public.live_memory_v3_mode_lock()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $mode$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('lm-v3|'||new.provider||'|'||new.identity, 0)
  );
  return new;
end;
$mode$;

create trigger live_memory_v3_mode_insert_lock
before insert on public.live_memory_v3_writer_modes
for each row execute function public.live_memory_v3_mode_lock();

create or replace function public.live_memory_v3_activate_personal()
returns text language plpgsql security invoker set search_path=pg_catalog
as $activate$
declare v_owner text := public.live_memory_owner_key();
begin
  if v_owner !~ '^[a-f0-9]{64}$' then
    raise exception 'V3_UNAUTHORIZED' using errcode='42501';
  end if;
  insert into public.live_memory_v3_writer_modes(provider,identity)
  values('personal',v_owner) on conflict do nothing;
  return 'v3';
end;
$activate$;

create or replace function public.live_memory_v3_activate_account()
returns text language plpgsql security invoker set search_path=pg_catalog
as $activate$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'V3_UNAUTHORIZED' using errcode='42501';
  end if;
  insert into public.live_memory_v3_writer_modes(provider,identity)
  values('account',v_user::text) on conflict do nothing;
  return 'v3';
end;
$activate$;

create or replace function public.live_memory_v3_mode_personal()
returns text language sql stable security invoker set search_path=pg_catalog
as $mode$
  select case when exists (
    select 1 from public.live_memory_v3_writer_modes
    where provider='personal' and identity=public.live_memory_owner_key()
  ) then 'v3' else 'v2' end;
$mode$;

create or replace function public.live_memory_v3_mode_account()
returns text language sql stable security invoker set search_path=pg_catalog
as $mode$
  select case when exists (
    select 1 from public.live_memory_v3_writer_modes
    where provider='account' and identity=(select auth.uid())::text
  ) then 'v3' else 'v2' end;
$mode$;

revoke all on function public.live_memory_v3_activate_personal() from public;
revoke all on function public.live_memory_v3_activate_account() from public,anon;
revoke all on function public.live_memory_v3_mode_personal() from public;
revoke all on function public.live_memory_v3_mode_account() from public,anon;
grant execute on function public.live_memory_v3_activate_personal() to anon,authenticated;
grant execute on function public.live_memory_v3_activate_account() to authenticated;
grant execute on function public.live_memory_v3_mode_personal() to anon,authenticated;
grant execute on function public.live_memory_v3_mode_account() to authenticated;

-- Ensure the helper trigger functions are not directly exposed via Data API.
revoke all on function public.live_memory_v3_mode_lock() from public,anon,authenticated;


-- SECURITY INVOKER for all CAS and guard functions; existing RLS continues.
-- The existing trigger is reusing this function without a drop/recreate.
create or replace function public.live_memory_v3_bump_revision()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $body$
declare
  v_provider text;
  v_identity text;
  v_fenced boolean;
begin
  if tg_table_name = 'echo_passkey_records' then
    v_provider := 'personal';
    v_identity := new.owner_key;
  elsif tg_table_name = 'echo_text_backups' then
    v_provider := 'account';
    v_identity := new.user_id::text;
  else
    raise exception 'V3_UNKNOWN_TARGET' using errcode = '22023';
  end if;
  -- Serializes the irreversible owner cutover with ANY old V2/V3 write,
  -- including an in-flight upsert that began before the activation RPC.
  perform pg_advisory_xact_lock(hashtextextended('lm-v3|' || v_provider || '|' || v_identity, 0));
  select exists(
    select 1 from public.live_memory_v3_writer_modes
     where provider = v_provider and identity = v_identity
  ) into v_fenced;
  if v_fenced and coalesce(current_setting('live_memory.v3_writer',true),'') <> '1' then
    raise exception 'V3_LEGACY_WRITE_FENCED' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.v3_revision := 1;
  else
    if old.v3_revision >= 9223372036854775806 then
      raise exception 'V3_REVISION_OVERFLOW' using errcode = '22003';
    end if;
    new.v3_revision := old.v3_revision + 1;
  end if;
  return new;
end;
$body$;

-- Account CAS preserves the text-only guard from migration 016.
create or replace function public.live_memory_v3_cas_account(
  p_id text,
  p_payload jsonb,
  p_expected_revision bigint
) returns table(id text, payload jsonb, v3_revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog
as $body$
declare
  v_user uuid := (select auth.uid());
  v_updated timestamptz;
  v_deleted timestamptz;
begin
  if v_user is null then
    raise exception 'V3_UNAUTHORIZED' using errcode = '42501';
  end if;
  if nullif(trim(p_id), '') is null
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload ->> 'id' is distinct from p_id then
    raise exception 'V3_INVALID_PAYLOAD' using errcode = '22023';
  end if;

  -- The account backup endpoint is intentionally TEXT-ONLY. Its transport
  -- must not accept ticket scans, image bodies, or media tombstones even if a
  -- malicious/old client forgets to project fields before calling the RPC.
  if p_payload ? 'media' and p_payload -> 'media' <> '[]'::jsonb then
    raise exception 'V3_ACCOUNT_MEDIA_FORBIDDEN' using errcode = '22023';
  end if;
  if p_payload ? 'mediaTombstones'
     and p_payload -> 'mediaTombstones' <> '[]'::jsonb
     and p_payload -> 'mediaTombstones' <> 'null'::jsonb then
    raise exception 'V3_ACCOUNT_MEDIA_FORBIDDEN' using errcode = '22023';
  end if;

  -- The writer flag exists only inside the server's CAS transaction.
  -- Client-side upserts cannot satisfy the fence simply by setting a React flag.
  perform set_config('live_memory.v3_writer','1',true);
  v_updated := coalesce(nullif(p_payload ->> 'updatedAt', '')::timestamptz, now());
  v_deleted := nullif(p_payload ->> 'deletedAt', '')::timestamptz;

  if p_expected_revision is null then
    insert into public.echo_text_backups as record (user_id, id, payload, updated_at, deleted_at)
    values (v_user, p_id, p_payload, v_updated, v_deleted)
    on conflict on constraint echo_text_backups_pkey do nothing
    returning record.id, record.payload, record.v3_revision
      into id, payload, v3_revision;
  else
    if p_expected_revision < 1 then
      raise exception 'V3_INVALID_REVISION' using errcode = '22023';
    end if;
    update public.echo_text_backups as record
      set payload = p_payload, updated_at = v_updated, deleted_at = v_deleted
      where record.user_id = v_user
        and record.id = p_id
        and record.v3_revision = p_expected_revision
      returning record.id, record.payload, record.v3_revision
        into id, payload, v3_revision;
  end if;

  if id is null then
    raise exception 'V3_REVISION_CONFLICT' using errcode = 'P0001';
  end if;
  return next;
end;
$body$;

-- Personal CAS preserves owner-key validation from migration 015.
create or replace function public.live_memory_v3_cas_personal(
  p_id text,
  p_payload jsonb,
  p_expected_revision bigint
) returns table(id text, payload jsonb, v3_revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog
as $body$
declare
  v_owner text := public.live_memory_owner_key();
  v_updated timestamptz;
  v_deleted timestamptz;
begin
  if v_owner !~ '^[a-f0-9]{64}$' then
    raise exception 'V3_UNAUTHORIZED' using errcode = '42501';
  end if;
  if nullif(trim(p_id), '') is null
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload ->> 'id' is distinct from p_id then
    raise exception 'V3_INVALID_PAYLOAD' using errcode = '22023';
  end if;

  -- The writer flag exists only inside the server's CAS transaction.
  -- Client-side upserts cannot satisfy the fence simply by setting a React flag.
  perform set_config('live_memory.v3_writer','1',true);
  v_updated := coalesce(nullif(p_payload ->> 'updatedAt', '')::timestamptz, now());
  v_deleted := nullif(p_payload ->> 'deletedAt', '')::timestamptz;

  if p_expected_revision is null then
    insert into public.echo_passkey_records as record (owner_key, id, payload, updated_at, deleted_at)
    values (v_owner, p_id, p_payload, v_updated, v_deleted)
    on conflict on constraint echo_passkey_records_pkey do nothing
    returning record.id, record.payload, record.v3_revision
      into id, payload, v3_revision;
  else
    if p_expected_revision < 1 then
      raise exception 'V3_INVALID_REVISION' using errcode = '22023';
    end if;
    update public.echo_passkey_records as record
      set payload = p_payload, updated_at = v_updated, deleted_at = v_deleted
      where record.owner_key = v_owner
        and record.id = p_id
        and record.v3_revision = p_expected_revision
      returning record.id, record.payload, record.v3_revision
        into id, payload, v3_revision;
  end if;

  if id is null then
    raise exception 'V3_REVISION_CONFLICT' using errcode = 'P0001';
  end if;
  return next;
end;
$body$;

-- An activation marker must NEVER be inserted automatically by a migration.
