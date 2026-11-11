-- Ephemeral PostgreSQL only. Migration 021 must reject early private
-- media even when an attacker possesses a legacy passkey ownerKey.
begin;
set local role anon;
set local request.headers='{"x-live-memory-owner-key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';
do $inactive$
declare rejected boolean:=false;
  folder text := encode(sha256(convert_to('live-memory-v3-media:'||repeat('a',64),'UTF8')),'hex');
begin
  if public.live_memory_v3_mode_personal() <> 'v2' then raise exception 'V3_PREACTIVATED'; end if;
  begin
    insert into storage.objects(bucket_id,name)
    values('echo-private-media-v3',folder||'/v3/private-media-before-cutover.webp');
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'V3_MEDIA_UPLOAD_ALLOWED_BEFORE_CUTOVER'; end if;
end;
$inactive$;

-- Operator-only activation is synthetic and rolled back below. Actual owners
-- are never activated by this test or the migration.
set local role postgres;
select public.live_memory_v3_activate_personal();
set local role anon;
do $active$
declare folder text := encode(sha256(convert_to('live-memory-v3-media:'||repeat('a',64),'UTF8')),'hex');
  n integer;
begin
  if public.live_memory_v3_mode_personal() <> 'v3' then raise exception 'V3_OPERATOR_ACTIVATION_FAILED'; end if;
  insert into storage.objects(bucket_id,name)
  values('echo-private-media-v3',folder||'/v3/private-media-after-cutover.webp');
  select count(*) into n from storage.objects where bucket_id='echo-private-media-v3';
  if n <> 1 then raise exception 'V3_ACTIVATED_MEDIA_NOT_READABLE'; end if;
end;
$active$;

set local request.headers='{"x-live-memory-owner-key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
do $owner_b$
declare rejected boolean:=false;
  folder text := encode(sha256(convert_to('live-memory-v3-media:'||repeat('b',64),'UTF8')),'hex');
  n integer;
begin
  select count(*) into n from storage.objects where bucket_id='echo-private-media-v3';
  if n <> 0 then raise exception 'V3_STORAGE_CROSS_OWNER_DATA_LEAK'; end if;
  begin
    insert into storage.objects(bucket_id,name)
    values('echo-private-media-v3',folder||'/v3/owner-b-unactivated.webp');
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'V3_STORAGE_UNACTIVATED_OWNER_B_UPLOAD_ALLOWED'; end if;
end;
$owner_b$;
rollback;

select 'PASS: inactive private Storage denied, activated owner-only private objects allowed, other owners fenced' as result;
