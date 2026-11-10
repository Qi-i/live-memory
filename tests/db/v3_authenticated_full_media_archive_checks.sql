-- Run only against disposable PostgreSQL 17; all synthetic rows roll back.
begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';

do $test$
declare
  user_a constant uuid:='11111111-1111-1111-1111-111111111111';
  rec_hash text;
  asset_hash text;
  object_path text;
  valid jsonb;
  reply record;
  failed boolean;
  prior_personal int;
  prior_account int;
  candidate jsonb;
begin
  select count(*) into prior_personal from public.echo_passkey_records;
  select count(*) into prior_account from public.echo_text_backups;
  rec_hash:=encode(sha256(convert_to('synthetic-event','UTF8')),'hex');
  asset_hash:=encode(sha256(convert_to('poster-1','UTF8')),'hex');
  object_path:=user_a::text||'/v3/'||rec_hash||'/'||asset_hash||'/'||repeat('c',64)||'.jpg';
  insert into storage.objects(bucket_id,name)
    values('echo-v3-media-staging',object_path);
  valid:=jsonb_build_object(
    'id','synthetic-event','title','Owner A media archive',
    'updatedAt','2026-11-10T10:00:00Z',
    'media',jsonb_build_array(jsonb_build_object(
      'id','poster-1','recordId','synthetic-event','kind','poster',
      'src','','storagePath',object_path))
  );

  -- An authenticated client must NOT bypass CAS by issuing raw table writes.
  failed:=false;
  begin
    insert into public.live_memory_v3_secure_records(user_id,id,payload)
    values(user_a,'direct',jsonb_build_object('id','direct','media','[]'::jsonb));
  exception when insufficient_privilege then
    failed:=true;
  end;
  if not failed then raise exception 'DIRECT_SECURE_ACCOUNT_WRITE_ALLOWED'; end if;

  -- No server cutover was needed to PREPARE a non-authoritative mirror.
  select * into reply from public.live_memory_v3_cas_secure_account(
    'synthetic-event',valid,null,user_a);
  if reply.v3_revision<>1 then raise exception 'SECURE_CAS_INSERT_FAILED'; end if;
  if current_setting('live_memory.v3_secure_cas',true) is distinct from '0' then
    raise exception 'SECURE_CAS_WRITER_TOKEN_NOT_CLEARED';
  end if;

  failed:=false;
  begin
    update public.live_memory_v3_secure_records
    set payload=jsonb_set(valid,'{title}','"forged bypass"'::jsonb)
    where id='synthetic-event';
  exception when insufficient_privilege then
    failed:=true;
  end;
  if not failed then raise exception 'DIRECT_SECURE_UPDATE_ALLOWED'; end if;

  select * into reply from public.live_memory_v3_cas_secure_account(
    'synthetic-event',
    jsonb_set(valid,'{title}','"verified update"'::jsonb),
    1,user_a);
  if reply.v3_revision<>2 then raise exception 'SECURE_CAS_UPDATE_FAILED'; end if;

  failed:=false;
  begin
    perform public.live_memory_v3_cas_secure_account(
      'synthetic-event',valid,1,user_a);
  exception when others then
    if sqlerrm like '%V3_SECURE_REVISION_CONFLICT%' then failed:=true;
    else raise; end if;
  end;
  if not failed then raise exception 'SECURE_CAS_ACCEPTED_STALE_WRITE'; end if;

  failed:=false;
  begin
    perform public.live_memory_v3_cas_secure_account(
      'synthetic-event',valid,null,user_a);
  exception when others then
    if sqlerrm like '%V3_SECURE_REVISION_CONFLICT%' then failed:=true;
    else raise; end if;
  end;
  if not failed then raise exception 'SECURE_CAS_ACCEPTED_DUPLICATE_INSERT'; end if;

  -- Forged image URL, foreign owner, missing Storage file and wrong asset IDs
  -- are rejected BEFORE any archive row change.
  for candidate in
    select unnest(array[
      jsonb_set(valid,'{media,0,src}','"data:image/jpeg;base64,PRIVATE_TICKET"'::jsonb),
      jsonb_set(valid,'{media,0,storagePath}',to_jsonb(
        '22222222-2222-2222-2222-222222222222/v3/'||rec_hash||'/'||asset_hash||'/'||repeat('c',64)||'.jpg')),
      jsonb_set(valid,'{media,0,storagePath}',to_jsonb(
        user_a::text||'/v3/'||rec_hash||'/'||asset_hash||'/'||repeat('d',64)||'.jpg')),
      jsonb_set(valid,'{media,0,recordId}','"forged-event"'::jsonb),
      jsonb_set(valid,'{media,0,id}','"wrong-poster"'::jsonb),
      jsonb_set(valid,'{media}','{}'::jsonb),
      jsonb_set(valid,'{media}','["corrupt"]'::jsonb)
    ])
  loop
    failed:=false;
    begin
      perform public.live_memory_v3_cas_secure_account(
        'synthetic-event',candidate,2,user_a);
    exception when others then
      if sqlerrm like '%V3_SECURE_MEDIA_NOT_STAGED%'
         or sqlerrm like '%V3_SECURE_INVALID_PAYLOAD%' then failed:=true;
      else raise; end if;
    end;
    if not failed then raise exception 'FORGED_MEDIA_WAS_STORED'; end if;
  end loop;
  if (select v3_revision from public.live_memory_v3_secure_records
      where id='synthetic-event')<>2 then
    raise exception 'FAILED_MEDIA_ATTEMPT_CHANGED_REVISION';
  end if;

  if (select count(*) from public.echo_passkey_records)<>prior_personal or
     (select count(*) from public.echo_text_backups)<>prior_account then
    raise exception 'SECURE_ARCHIVE_TOUCHED_LEGACY_V2_DATA';
  end if;
  if exists(select 1 from public.live_memory_v3_writer_modes
     where provider='account' and identity=user_a::text) then
    raise exception 'SECURE_MIRROR_PREMATURELY_ACTIVATED_V3_WRITER';
  end if;
end;
$test$;

set local request.jwt.claim.sub='22222222-2222-2222-2222-222222222222';
do $switched$
declare
  failed boolean:=false;
begin
  if exists(select 1 from public.live_memory_v3_secure_records
     where id='synthetic-event') then
    raise exception 'ACCOUNT_B_READ_ACCOUNT_A_ARCHIVE';
  end if;
  begin
    perform public.live_memory_v3_cas_secure_account(
      'synthetic-event','{"id":"synthetic-event","media":[]}'::jsonb,
      null,'11111111-1111-1111-1111-111111111111'::uuid);
  exception when insufficient_privilege then
    failed:=true;
  end;
  if not failed then raise exception 'SESSION_SWITCH_COPIED_ACCOUNT_A_ARCHIVE'; end if;
end;
$switched$;

set local role anon;
do $anon$
declare
  blocked boolean:=false;
begin
  -- The stronger behavior is that anon lacks table SELECT permission
  -- entirely (rather than merely receiving zero rows through RLS).
  blocked:=false;
  begin
    perform 1 from public.live_memory_v3_secure_records limit 1;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'ANONYMOUS_READ_SECURE_ARCHIVE'; end if;
  blocked:=false;
  begin
    perform public.live_memory_v3_cas_secure_account(
      'anonymous','{"id":"anonymous","media":[]}'::jsonb,null,
      '11111111-1111-1111-1111-111111111111'::uuid);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'ANONYMOUS_CALLED_SECURE_CAS'; end if;
end;
$anon$;

rollback;
select 'PASS: private authenticated archive, media integrity, no direct writes, monotonic CAS, tenant isolation, untouched V2' as result;
