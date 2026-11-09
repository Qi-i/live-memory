-- V3 account isolation: prevent an auth session switch between a UI
-- read and the cloud CAS from accidentally writing a different user's data.
-- The expected UUID is bound to the opening account's IndexedDB scope.
--
-- This is additive: leave V2, the original CAS function, and all rows intact.
create or replace function public.live_memory_v3_cas_account_scoped(
  p_id text,
  p_payload jsonb,
  p_expected_revision bigint,
  p_expected_user uuid
) returns table(id text, payload jsonb, v3_revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog
as $body$
begin
  -- Validation and the original CAS execute in ONE database transaction
  -- under ONE authenticated JWT. A switched browser session may only fail.
  if p_expected_user is null
     or (select auth.uid()) is distinct from p_expected_user then
    raise exception 'V3_ACCOUNT_SESSION_CHANGED' using errcode='42501';
  end if;

  return query
    select verified.id, verified.payload, verified.v3_revision
    from public.live_memory_v3_cas_account(
      p_id, p_payload, p_expected_revision
    ) as verified;
end;
$body$;

revoke all on function public.live_memory_v3_cas_account_scoped(text,jsonb,bigint,uuid)
  from public,anon;
grant execute on function public.live_memory_v3_cas_account_scoped(text,jsonb,bigint,uuid)
  to authenticated;
