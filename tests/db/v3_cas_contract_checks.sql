-- EPHEMERAL CI database only. Checks actual PostgreSQL CAS, RLS and legacy-upsert version bumps.
-- This file is run as the test superuser, with SET ROLE for access-control assertions.

set role anon;
set request.headers = '{"x-live-memory-owner-key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';

do $$
declare r record;
begin
  select * into r from public.live_memory_v3_cas_personal(
    'show-1', '{"id":"show-1","title":"First live"}'::jsonb, null
  );
  if r.v3_revision <> 1 or r.payload->>'title' <> 'First live' then
    raise exception 'Personal CAS create failed';
  end if;

  select * into r from public.live_memory_v3_cas_personal(
    'show-1', '{"id":"show-1","title":"Second live"}'::jsonb, 1
  );
  if r.v3_revision <> 2 or r.payload->>'title' <> 'Second live' then
    raise exception 'Personal CAS revision update failed';
  end if;

  begin
    perform public.live_memory_v3_cas_personal('show-1', '{"id":"show-1","title":"stale"}'::jsonb, 1);
    raise exception 'Expected stale CAS to fail';
  exception when others then
    if sqlerrm not like '%V3_REVISION_CONFLICT%' then raise; end if;
  end;

  begin
    perform public.live_memory_v3_cas_personal('show-1', '{"id":"show-1","title":"clobber"}'::jsonb, null);
    raise exception 'Expected create-only conflict';
  exception when others then
    if sqlerrm not like '%V3_REVISION_CONFLICT%' then raise; end if;
  end;

  begin
    perform public.live_memory_v3_cas_personal('show-1', '{"id":"incorrect","title":"invalid"}'::jsonb, 2);
    raise exception 'Expected payload-ID mismatch failure';
  exception when others then
    if sqlerrm not like '%V3_INVALID_RECORD%' then raise; end if;
  end;
end;
$$;

-- A V2 client still issuing direct table UPDATE must bump the SAME server revision.
update public.echo_passkey_records
set payload = '{"id":"show-1","title":"V2 updated while V3 is running"}'::jsonb
where id = 'show-1';

do $$
declare r record;
begin
  select id,payload,v3_revision into r from public.echo_passkey_records where id='show-1';
  if r.v3_revision <> 3 then raise exception 'Legacy personal UPDATE did not bump the server revision'; end if;
  begin
    perform public.live_memory_v3_cas_personal('show-1', '{"id":"show-1","title":"stale writer"}'::jsonb, 2);
    raise exception 'Expected post-V2 stale CAS failure';
  exception when others then
    if sqlerrm not like '%V3_REVISION_CONFLICT%' then raise; end if;
  end;

  select * into r from public.live_memory_v3_cas_personal(
    'show-1', '{"id":"show-1","title":"Tombstone","deletedAt":"2026-11-09T00:00:00Z"}'::jsonb, 3
  );
  if r.v3_revision <> 4 then raise exception 'Tombstone update did not advance revision'; end if;
  if (select deleted_at from public.echo_passkey_records where id='show-1') is null
  then raise exception 'Tombstone was dropped'; end if;
end;
$$;

-- A different owner-key cannot read, update or overwrite the first owner's records.
set request.headers = '{"x-live-memory-owner-key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
do $$
declare r record;
begin
  if (select count(*) from public.echo_passkey_records where id='show-1') <> 0
  then raise exception 'RLS exposed another owner-key record'; end if;
  begin
    perform public.live_memory_v3_cas_personal('show-1', '{"id":"show-1","title":"attack"}'::jsonb, 4);
    raise exception 'Expected unauthorized revision conflict';
  exception when others then
    if sqlerrm not like '%V3_REVISION_CONFLICT%' then raise; end if;
  end;
  select * into r from public.live_memory_v3_cas_personal(
    'show-1', '{"id":"show-1","title":"Separate owner"}'::jsonb, null
  );
  if r.v3_revision <> 1 or r.payload->>'title' <> 'Separate owner'
  then raise exception 'Independent owner create failed'; end if;
end;
$$;

set request.headers = '{}';
do $$
begin
  begin
    perform public.live_memory_v3_cas_personal('missing', '{"id":"missing"}'::jsonb, null);
    raise exception 'Expected missing owner-key denial';
  exception when others then
    if sqlerrm not like '%V3_OWNER_NOT_AUTHORIZED%' then raise; end if;
  end;
end;
$$;
reset role;

-- Anonymous clients cannot execute account CAS.
do $$
begin
  if has_function_privilege('anon','public.live_memory_v3_cas_account(text,jsonb,bigint)','EXECUTE')
  then raise exception 'Anonymous account CAS EXECUTE was granted'; end if;
end;
$$;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare r record;
begin
  select * into r from public.live_memory_v3_cas_account(
    'account-1','{"id":"account-1","title":"First account backup","media":[]}'::jsonb,null
  );
  if r.v3_revision <> 1 then raise exception 'Account create failed'; end if;

  begin
    perform public.live_memory_v3_cas_account('private', '{"id":"private","media":[{"src":"private"}]}'::jsonb, null);
    raise exception 'Expected media privacy rejection';
  exception when others then
    if sqlerrm not like '%V3_ACCOUNT_MEDIA_FORBIDDEN%' then raise; end if;
  end;

  select * into r from public.live_memory_v3_cas_account(
    'account-1','{"id":"account-1","title":"Second account backup","media":[]}'::jsonb,1
  );
  if r.v3_revision <> 2 then raise exception 'Account CAS update failed'; end if;
end;
$$;

update public.echo_text_backups
set payload = '{"id":"account-1","title":"Legacy text backup","media":[]}'::jsonb
where id='account-1';

do $$
declare r record;
begin
  select id,payload,v3_revision into r from public.echo_text_backups where id='account-1';
  if r.v3_revision <> 3 then raise exception 'Legacy account backup UPDATE did not bump revision'; end if;
  begin
    perform public.live_memory_v3_cas_account('account-1','{"id":"account-1","title":"stale","media":[]}'::jsonb,2);
    raise exception 'Expected stale account revision conflict';
  exception when others then
    if sqlerrm not like '%V3_REVISION_CONFLICT%' then raise; end if;
  end;
end;
$$;

-- Switching auth.uid isolates rows using the existing RLS contract.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
declare r record;
begin
  if (select count(*) from public.echo_text_backups where id='account-1') <> 0
  then raise exception 'RLS exposed another auth user backup'; end if;
  begin
    perform public.live_memory_v3_cas_account('account-1','{"id":"account-1","title":"attack","media":[]}'::jsonb,3);
    raise exception 'Expected cross-account CAS rejection';
  exception when others then
    if sqlerrm not like '%V3_REVISION_CONFLICT%' then raise; end if;
  end;
  select * into r from public.live_memory_v3_cas_account('account-1',
    '{"id":"account-1","title":"Independent account","media":[]}'::jsonb,null);
  if r.v3_revision <> 1 then raise exception 'Independent auth account create failed'; end if;
end;
$$;
reset role;
select 'PASS: server CAS, stale version, legacy update trigger, owner-key RLS, auth RLS, media policy and tombstones' as result;
