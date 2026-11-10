-- Full-media authenticated V3 archive, isolated from BOTH legacy V2
-- echo_passkey_records and echo_text_backups. No V2 rows, old Storage images,
-- credentials or writer-mode flags are modified or activated here.
--
-- This is a safe account-owned MIRROR destination for subsequent audited
-- migration; merely populating it must not disable existing V2 devices.
create table if not exists public.live_memory_v3_secure_records (
  user_id uuid not null,
  id text not null check (length(trim(id)) between 1 and 512),
  payload jsonb not null,
  v3_revision bigint not null default 1 check (v3_revision >= 1),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id,id),
  constraint v3_secure_payload_id_matches check (payload ->> 'id' = id)
);

alter table public.live_memory_v3_secure_records enable row level security;

create policy "v3 secure archive account select"
on public.live_memory_v3_secure_records for select to authenticated
using (user_id=(select auth.uid()));

create policy "v3 secure archive account insert"
on public.live_memory_v3_secure_records for insert to authenticated
with check (user_id=(select auth.uid()));

create policy "v3 secure archive account update"
on public.live_memory_v3_secure_records for update to authenticated
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()));

-- Required for invoker CAS. Direct table POST/PATCH is separately blocked by
-- a trigger; the authenticated client may never delete archived records.
grant select,insert,update on public.live_memory_v3_secure_records to authenticated;
revoke all on public.live_memory_v3_secure_records from anon;

create or replace function public.live_memory_v3_secure_cas_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $guard$
begin
  if current_setting('live_memory.v3_secure_cas',true) is distinct from '1' then
    raise exception 'V3_SECURE_DIRECT_WRITE_FENCED' using errcode='42501';
  end if;
  if (select auth.uid()) is distinct from new.user_id then
    raise exception 'V3_SECURE_ACCOUNT_CHANGED' using errcode='42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.id is distinct from old.id then
      raise exception 'V3_SECURE_IDENTITY_IMMUTABLE' using errcode='42501';
    end if;
    new.v3_revision := old.v3_revision+1;
  else
    new.v3_revision := 1;
  end if;
  return new;
end;
$guard$;

create trigger live_memory_v3_secure_cas_guard
before insert or update on public.live_memory_v3_secure_records
for each row execute function public.live_memory_v3_secure_cas_guard();

create or replace function public.live_memory_v3_cas_secure_account(
  p_id text,
  p_payload jsonb,
  p_expected_revision bigint,
  p_expected_user uuid
)
returns table(id text,payload jsonb,v3_revision bigint)
language plpgsql security invoker set search_path=pg_catalog
as $body$
declare
  v_user uuid := (select auth.uid());
  v_updated timestamptz;
  v_deleted timestamptz;
begin
  if v_user is null or p_expected_user is null
     or v_user is distinct from p_expected_user then
    raise exception 'V3_SECURE_ACCOUNT_CHANGED' using errcode='42501';
  end if;
  if p_id is null or length(trim(p_id)) not between 1 and 512
     or p_payload is null or jsonb_typeof(p_payload)<>'object'
     or p_payload ->> 'id' is distinct from p_id
     or jsonb_typeof(p_payload -> 'media') is distinct from 'array' then
    raise exception 'V3_SECURE_INVALID_PAYLOAD' using errcode='22023';
  end if;
  if p_expected_revision is not null and p_expected_revision<1 then
    raise exception 'V3_SECURE_INVALID_REVISION' using errcode='22023';
  end if;

  -- User-scoped locks serialize import, editor and second-device CAS even
  -- when the row did not exist at the time of the first request.
  perform pg_advisory_xact_lock(
    hashtextextended('lm-v3-secure|'||v_user::text||'|'||p_id,0)
  );

  -- No data URLs, public legacy paths or expiring signed tokens are stored
  -- in cloud JSON. Every media object must exist in the authenticated
  -- owner's private staging bucket, with hashes derived from record+asset.
  if exists (
    select 1 from jsonb_array_elements(p_payload->'media') as item(value)
    where jsonb_typeof(item.value) <> 'object'
       or coalesce(item.value->>'id','')=''
       or item.value->>'recordId' is distinct from p_id
       or item.value->>'src' is distinct from ''
       or coalesce(item.value->>'storagePath','') !~ (
          '^'||v_user::text||'/v3/'||
          pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_id,'UTF8')),'hex')||
          '/'||pg_catalog.encode(pg_catalog.sha256(
            pg_catalog.convert_to(coalesce(item.value->>'id',''),'UTF8')),'hex')||
          '/[a-f0-9]{64}\.(jpg|png|webp|gif|avif)$'
       )
       or not exists (
          select 1 from storage.objects as object
          where object.bucket_id='echo-v3-media-staging'
            and object.name=item.value->>'storagePath'
       )
  ) then
    raise exception 'V3_SECURE_MEDIA_NOT_STAGED' using errcode='22023';
  end if;

  v_updated:=coalesce(nullif(p_payload->>'updatedAt','')::timestamptz,now());
  v_deleted:=nullif(p_payload->>'deletedAt','')::timestamptz;
  perform set_config('live_memory.v3_secure_cas','1',true);
  if p_expected_revision is null then
    insert into public.live_memory_v3_secure_records as archive
      (user_id,id,payload,updated_at,deleted_at)
    values (v_user,p_id,p_payload,v_updated,v_deleted)
    on conflict on constraint live_memory_v3_secure_records_pkey do nothing
    returning archive.id,archive.payload,archive.v3_revision
      into id,payload,v3_revision;
  else
    update public.live_memory_v3_secure_records as archive
    set payload=p_payload,updated_at=v_updated,deleted_at=v_deleted
    where archive.user_id=v_user and archive.id=p_id
      and archive.v3_revision=p_expected_revision
    returning archive.id,archive.payload,archive.v3_revision
      into id,payload,v3_revision;
  end if;
  perform set_config('live_memory.v3_secure_cas','0',true);
  if id is null then
    raise exception 'V3_SECURE_REVISION_CONFLICT' using errcode='P0001';
  end if;
  return next;
end;
$body$;

revoke all on function public.live_memory_v3_cas_secure_account(
  text,jsonb,bigint,uuid) from public,anon;
grant execute on function public.live_memory_v3_cas_secure_account(
  text,jsonb,bigint,uuid) to authenticated;

-- A migration mirror is not authoritative while legacy V2 still writes.
-- The existing separately audited account writer marker controls promotion.
comment on table public.live_memory_v3_secure_records is
  'Authenticated, full-media V3 migration mirror; independent of legacy V2 rows and credential.';
