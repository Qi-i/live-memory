-- Ephemeral PostgreSQL 17 only. A CAS bypass must NOT persist private
-- ticket bytes, token-bearing URLs, foreign objects or nonexistent assets.
begin;
set local request.headers='{"x-live-memory-owner-key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';
set local role postgres;
select public.live_memory_v3_activate_personal();
set local role anon;

do $media$
declare
  owner_key constant text := repeat('a',64);
  folder text;
  object_path text;
  sample jsonb;
  invalids jsonb[];
  candidate jsonb;
  cas_response record;
  bad_count integer;
begin
  folder := encode(sha256(convert_to('live-memory-v3-media:'||owner_key,'UTF8')),'hex');
  object_path := folder||'/v3/'||repeat('1',64)||'/'||repeat('2',64)||'/'||repeat('3',64)||'.png';
  insert into storage.objects(bucket_id,name)
    values('echo-private-media-v3',object_path);
  sample := jsonb_build_object(
    'id','media-safe-show','title','Storage-bound media',
    'media',jsonb_build_array(jsonb_build_object(
      'id','poster-a','recordId','media-safe-show','kind','poster',
      'src','','storagePath',object_path
    ))
  );

  invalids := array[
    jsonb_set(sample,'{media,0,src}','"data:image/png;base64,PRIVATE_BYTES"'::jsonb),
    jsonb_set(sample,'{media,0,src}','"https://cdn.example.test/?token=PRIVATE"'::jsonb),
    jsonb_set(sample,'{media,0,storagePath}',to_jsonb(owner_key||'/v3/'||
      repeat('1',64)||'/'||repeat('2',64)||'/'||repeat('3',64)||'.png')),
    jsonb_set(sample,'{media,0,storagePath}',to_jsonb(repeat('b',64)||'/v3/'||
      repeat('1',64)||'/'||repeat('2',64)||'/'||repeat('3',64)||'.png')),
    jsonb_set(sample,'{media,0,storagePath}',to_jsonb(folder||'/v3/'||
      repeat('1',64)||'/'||repeat('2',64)||'/'||repeat('4',64)||'.png')),
    jsonb_set(sample,'{media,0,recordId}','"other-show"'::jsonb),
    jsonb_set(sample,'{media,0,id}','""'::jsonb),
    jsonb_set(sample,'{media,0,storagePath}','null'::jsonb),
    jsonb_set(sample,'{media}','{}'::jsonb),
    jsonb_set(sample,'{media}','["corrupt"]'::jsonb)
  ];

  foreach candidate in array invalids loop
    begin
      perform public.live_memory_v3_cas_personal('media-safe-show',candidate,null);
      raise exception 'V3_TEST_UNSAFE_PRIVATE_MEDIA_COMMITTED';
    exception when others then
      if sqlerrm not like '%V3_MEDIA_PAYLOAD_NOT_PORTABLE%' then raise; end if;
    end;
  end loop;
  select count(*) into bad_count from public.echo_passkey_records
    where id='media-safe-show';
  if bad_count<>0 then raise exception 'V3_TEST_FAILED_MEDIA_ATTEMPT_CHANGED_RECORDS'; end if;

  select * into cas_response from public.live_memory_v3_cas_personal(
    'media-safe-show', sample, null
  );
  if cas_response.v3_revision<>1 then raise exception 'V3_TEST_VALID_PRIVATE_MEDIA_REJECTED'; end if;
  select * into cas_response from public.live_memory_v3_cas_personal(
    'media-safe-show',jsonb_set(sample,'{title}','"validated edit"'::jsonb),1
  );
  if cas_response.v3_revision<>2 then raise exception 'V3_TEST_VALID_PRIVATE_MEDIA_UPDATE_FAILED'; end if;
  if (select payload->'media'->0->>'src' from public.echo_passkey_records
      where id='media-safe-show')<>'' then
    raise exception 'V3_TEST_PRIVATE_URL_INCLUDED_IN_CLOUD_JSON';
  end if;
end;
$media$;
rollback;

select 'PASS: forged media JSON refused, physical private object required, owner CAS safe' as result;
