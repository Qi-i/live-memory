-- V3 cutover safety hardening: CAS cannot write before the actual owner
-- has entered V3 mode. This fixes the low-level RPC bypass of the application
-- writerMode() check. No archive data or activation marker is modified.
--
-- The V2 personal ownerKey may be recoverable from legacy public object URLs.
-- Until an independent authenticated rekey flow exists, never allow a
-- passkey-only anonymous client to activate V3 and lock legacy V2 writers.
revoke all on function public.live_memory_v3_activate_personal()
  from public, anon, authenticated;

-- Do not allow direct table INSERT to bypass the revoked RPC. The old
-- ownerKey is not proof of independently authenticated ownership. Account
-- owners may still activate only their OWN account via auth.uid().
revoke insert on public.live_memory_v3_writer_modes from anon;
drop policy if exists v3_writer_mode_activate on public.live_memory_v3_writer_modes;
create policy v3_writer_mode_activate on public.live_memory_v3_writer_modes
for insert to authenticated
with check (
  provider='account' and identity=(select auth.uid())::text
);



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
  -- The server, not the web app, enforces the V3 activation boundary.
  -- Serialize against activation so a V2 client can never race a pre-cutover
  -- CAS write into an owner that is still using blind legacy upserts.
  perform pg_advisory_xact_lock(
    hashtextextended('lm-v3|account|' || v_user::text, 0)
  );
  if not exists (
    select 1 from public.live_memory_v3_writer_modes
    where provider='account' and identity=v_user::text
  ) then
    raise exception 'V3_OWNER_NOT_ACTIVATED' using errcode='42501';
  end if;
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
  perform set_config('live_memory.v3_writer','0',true);
  return next;
end;
$body$;

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
