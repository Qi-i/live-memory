-- V3 server-side media integrity gate, no data modification.
-- Forged direct CAS RPCs may not store raw tickets, signed URLs, foreign
-- object paths or media belonging to a different record.
-- Retains the activation gate, owner lock, RLS invoker, and CAS revisions.
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

  -- An RPC caller cannot bypass the browser media staging/portability gate.
  if p_payload ? 'media' then
    if jsonb_typeof(p_payload->'media') <> 'array' then
      raise exception 'V3_MEDIA_PAYLOAD_NOT_PORTABLE' using errcode='22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_payload->'media') as item(value)
      where jsonb_typeof(item.value) <> 'object'
        or nullif(item.value->>'id','') is null
        or item.value->>'recordId' is distinct from p_id
        or item.value->>'src' is distinct from ''
        or coalesce(item.value->>'storagePath','') !~ (
          '^' || pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(
              'live-memory-v3-media:'||v_owner,'UTF8'
            )), 'hex'
          ) || '/v3/[a-f0-9]{64}/[a-f0-9]{64}/[a-f0-9]{64}\.(jpg|png|webp|gif|avif)$'
        )
        or not exists (
          select 1 from storage.objects as media_object
          where media_object.bucket_id='echo-private-media-v3'
            and media_object.name=item.value->>'storagePath'
        )
    ) then
      raise exception 'V3_MEDIA_PAYLOAD_NOT_PORTABLE' using errcode='22023';
    end if;
  end if;

  -- The writer flag exists only inside the server's CAS transaction.
  -- Client-side upserts cannot satisfy the fence simply by setting a React flag.
  -- The server, not the web app, enforces the V3 activation boundary.
  -- Serialize against activation so a V2 client can never race a pre-cutover
  -- CAS write into an owner that is still using blind legacy upserts.
  perform pg_advisory_xact_lock(
    hashtextextended('lm-v3|personal|' || v_owner, 0)
  );
  if not exists (
    select 1 from public.live_memory_v3_writer_modes
    where provider='personal' and identity=v_owner
  ) then
    raise exception 'V3_OWNER_NOT_ACTIVATED' using errcode='42501';
  end if;
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
  perform set_config('live_memory.v3_writer','0',true);
  return next;
end;
$body$;
