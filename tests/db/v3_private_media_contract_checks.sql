-- Real Postgres RLS/security assertions. Runs in the job-local test instance.
-- Only synthetic owner keys and objects; no production database or images.
do $preflight$
declare is_private boolean; policy_count integer;
begin
  select not public into is_private from storage.buckets where id='echo-private-media-v3';
  if is_private is distinct from true then
    raise exception 'V3_TEST_BUCKET_PUBLIC_OR_MISSING';
  end if;
  select count(*) into policy_count from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname in ('v3 private media owner insert','v3 private media owner read');
  if policy_count <> 2 then raise exception 'V3_TEST_PRIVATE_RLS_POLICIES_MISSING'; end if;
  if not (select relrowsecurity from pg_class
      where oid='storage.objects'::regclass) then
    raise exception 'V3_TEST_PRIVATE_RLS_DISABLED';
  end if;
end;
$preflight$;

begin;
set local role anon;
set local request.headers = '{"x-live-memory-owner-key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';
insert into storage.objects(bucket_id,name)
values('echo-private-media-v3','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/v3/synthetic/photo.webp');
do $owner_a$
declare n integer;
begin
 select count(*) into n from storage.objects
 where bucket_id='echo-private-media-v3';
 if n <> 1 then raise exception 'V3_TEST_OWNER_A_CANNOT_READ'; end if;
end;
$owner_a$;

set local request.headers = '{"x-live-memory-owner-key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
do $owner_b$
declare n integer; rejected boolean:=false;
begin
 select count(*) into n from storage.objects where bucket_id='echo-private-media-v3';
 if n <> 0 then raise exception 'V3_TEST_CROSS_OWNER_READ'; end if;
 begin
   insert into storage.objects(bucket_id,name)
   values('echo-private-media-v3','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/v3/foreign.webp');
 exception when insufficient_privilege then rejected:=true;
 end;
 if not rejected then raise exception 'V3_TEST_CROSS_OWNER_UPLOAD_ALLOWED'; end if;
end;
$owner_b$;

set local request.headers = '{}';
do $missing$
declare n integer; rejected boolean:=false;
begin
 select count(*) into n from storage.objects where bucket_id='echo-private-media-v3';
 if n <> 0 then raise exception 'V3_TEST_ANONYMOUS_READ_ALLOWED'; end if;
 begin
   insert into storage.objects(bucket_id,name)
   values('echo-private-media-v3','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc/v3/unknown.webp');
 exception when insufficient_privilege then rejected:=true;
 end;
 if not rejected then raise exception 'V3_TEST_NO_OWNER_UPLOAD_ALLOWED'; end if;
end;
$missing$;
rollback;

select 'V3 private media RLS and owner-only upload/read passed' as result;
