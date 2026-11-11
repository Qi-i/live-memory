-- Live Memory V3: additive compare-and-swap support on existing cloud tables.
-- Preflight: back up the existing table schemas and verify current RLS policies.
-- No existing payload is modified or deleted. V2 readers and writers remain valid.
-- Run only after review; the V3 client stays disabled until the migration is verified.

alter table public.echo_text_backups
  add column if not exists v3_revision bigint not null default 1;
alter table public.echo_passkey_records
  add column if not exists v3_revision bigint not null default 1;

-- Even a legacy V2 unconditional upsert must advance the server revision.
-- This ensures that a V3 CAS never ignores an intervening V2 edit.
create or replace function public.live_memory_v3_bump_revision()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $body$
begin
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

drop trigger if exists live_memory_v3_revision_account on public.echo_text_backups;
create trigger live_memory_v3_revision_account
  before insert or update on public.echo_text_backups
  for each row execute function public.live_memory_v3_bump_revision();

drop trigger if exists live_memory_v3_revision_personal on public.echo_passkey_records;
create trigger live_memory_v3_revision_personal
  before insert or update on public.echo_passkey_records
  for each row execute function public.live_memory_v3_bump_revision();

-- Keep the owner identity derived exclusively from an authenticated JWT.
-- This routine is SECURITY INVOKER, so existing RLS is checked on both paths.
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

-- The personal cloud uses the same fixed-header owner-key identity and RLS
-- as the existing V2 tables. Never accept owner_key from the caller's payload.
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

-- Do not grant public access merely because a routine lives in public.
revoke all on function public.live_memory_v3_cas_account(text,jsonb,bigint) from public, anon;
revoke all on function public.live_memory_v3_cas_personal(text,jsonb,bigint) from public;
grant execute on function public.live_memory_v3_cas_account(text,jsonb,bigint) to authenticated;
grant execute on function public.live_memory_v3_cas_personal(text,jsonb,bigint) to anon, authenticated;

comment on column public.echo_text_backups.v3_revision is
  'Monotonic server-side CAS version; automatically incremented even by legacy V2 writes.';
comment on column public.echo_passkey_records.v3_revision is
  'Monotonic server-side CAS version; automatically incremented even by legacy V2 writes.';
