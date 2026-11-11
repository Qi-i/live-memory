-- Additive hardening after V3 CAS installation; no row payloads are altered.
-- Same security-invoker signature, same owner identity, same CAS behavior.

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

revoke all on function public.live_memory_v3_cas_account(text,jsonb,bigint) from public, anon;
grant execute on function public.live_memory_v3_cas_account(text,jsonb,bigint) to authenticated;
