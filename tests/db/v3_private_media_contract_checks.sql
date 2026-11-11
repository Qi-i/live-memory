-- Real Postgres 17 Storage RLS verification using synthetic owner credentials.
-- The client must never write its raw authorization key into an object name.
do $preflight$
declare is_private boolean; policy_count integer;
begin
  select not public into is_private from storage.buckets where id='echo-private-media-v3';
  if is_private is distinct from true then raise exception 'V3_PRIVATE_BUCKET_MISSING'; end if;
  select count(*) into policy_count from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname in ('v3 private media owner insert','v3 private media owner read');
  if policy_count <> 2 then raise exception 'V3_MEDIA_RLS_POLICIES_MISSING'; end if;
  if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then
    raise exception 'V3_MEDIA_RLS_OFF';
  end if;
end;
$preflight$;

begin;
set local role anon;
set local request.headers='{"x-live-memory-owner-key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';
do $owner_a$
declare
  raw_key constant text := repeat('a',64);
  hashed_folder text := encode(sha256(convert_to('live-memory-v3-media:'||raw_key,'UTF8')),'hex');
  denied boolean := false;
  count_visible int;
begin
  if position(raw_key in hashed_folder) > 0 or length(hashed_folder) <> 64 then
    raise exception 'V3_MEDIA_PATH_EXPOSES_CREDENTIAL';
  end if;
  insert into storage.objects(bucket_id,name)
  values('echo-private-media-v3', hashed_folder||'/v3/synthetic/photo.webp');
  select count(*) into count_visible from storage.objects
  where bucket_id='echo-private-media-v3';
  if count_visible <> 1 then raise exception 'V3_OWNER_A_PRIVATE_READ_FAILED'; end if;
  begin
    insert into storage.objects(bucket_id,name)
    values('echo-private-media-v3',raw_key||'/v3/UNSAFE-CREDENTIAL-PATH.webp');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'V3_RAW_OWNER_CREDENTIAL_UPLOAD_ALLOWED'; end if;
end;
$owner_a$;

set local request.headers='{"x-live-memory-owner-key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
do $owner_b$
declare
  folder_a text := encode(sha256(convert_to('live-memory-v3-media:'||repeat('a',64),'UTF8')),'hex');
  folder_b text := encode(sha256(convert_to('live-memory-v3-media:'||repeat('b',64),'UTF8')),'hex');
  denied boolean := false;
  count_visible int;
begin
  select count(*) into count_visible from storage.objects
  where bucket_id='echo-private-media-v3';
  if count_visible <> 0 then raise exception 'V3_CROSS_OWNER_READ_ALLOWED'; end if;
  begin
    insert into storage.objects(bucket_id,name)
    values('echo-private-media-v3',folder_a||'/v3/foreign.webp');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'V3_CROSS_OWNER_UPLOAD_ALLOWED'; end if;
  insert into storage.objects(bucket_id,name)
  values('echo-private-media-v3',folder_b||'/v3/valid-b.webp');
  select count(*) into count_visible from storage.objects
  where bucket_id='echo-private-media-v3';
  if count_visible <> 1 then raise exception 'V3_OWNER_B_PRIVATE_READ_FAILED'; end if;
end;
$owner_b$;

set local request.headers='{}';
do $no_credential$
declare denied boolean := false; count_visible int;
begin
  select count(*) into count_visible from storage.objects
  where bucket_id='echo-private-media-v3';
  if count_visible <> 0 then raise exception 'V3_NO_CREDENTIAL_READ_ALLOWED'; end if;
  begin
    insert into storage.objects(bucket_id,name)
    values('echo-private-media-v3',repeat('c',64)||'/v3/unknown.webp');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'V3_NO_CREDENTIAL_UPLOAD_ALLOWED'; end if;
end;
$no_credential$;
rollback;

select 'V3 blinded Storage paths: owner-key is absent, signed path prefixes cannot authorize, RLS scopes pass' as result;
