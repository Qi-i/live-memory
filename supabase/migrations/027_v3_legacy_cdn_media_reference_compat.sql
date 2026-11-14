-- V3 one-account historical media compatibility. This does NOT weaken RLS,
-- grant public write access, delete V2 records, or activate the writer marker.
-- Only exact historical HTTPS img.alicdn.com poster / seat-map references
-- (not locally stored files) may persist as URL-only items.
-- All private-media items still require owner-scoped immutable staged objects.
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

  -- Private media must have immutable owner-scoped copies. Historical V2
  -- Damai posters / seat maps only existed as external HTTPS URL references;
  -- preserve them without incorrectly claiming those original bytes were copied.
  if exists (
    select 1 from jsonb_array_elements(p_payload->'media') as item(value)
    where jsonb_typeof(item.value) <> 'object'
       or coalesce(item.value->>'id','')=''
       or item.value->>'recordId' is distinct from p_id
       or not (
         (
           item.value->>'src' = ''
           and coalesce(item.value->>'storagePath','') ~ (
             '^'||v_user::text||'/v3/'||
             pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_id,'UTF8')),'hex')||
             '/'||pg_catalog.encode(pg_catalog.sha256(
               pg_catalog.convert_to(coalesce(item.value->>'id',''),'UTF8')),'hex')||
             '/[a-f0-9]{64}\\.(jpg|png|webp|gif|avif)$'
           )
           and exists (
             select 1 from storage.objects as object
             where object.bucket_id='echo-v3-media-staging'
               and object.name=item.value->>'storagePath'
           )
         )
         or (
           coalesce(item.value->>'storagePath','')=''
           and length(coalesce(item.value->>'src','')) between 1 and 4096
           and item.value->>'src' ~
             '^https://img[.]alicdn[.]com/[^[:space:]]+$'
         )
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

