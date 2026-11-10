-- Ephemeral local PostgreSQL only. Synthetic user IDs; rollback ALL rows.
begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';

do $a$
declare
  recordhash text:=repeat('a',64);
  assethash text:=repeat('b',64);
  contenthash text:=repeat('c',64);
  okay text;
  refused boolean;
begin
  okay:='11111111-1111-1111-1111-111111111111/v3/'||
    recordhash||'/'||assethash||'/'||contenthash||'.png';
  insert into storage.objects(bucket_id,name)
    values('echo-v3-media-staging',okay);
  if (select count(*) from storage.objects where bucket_id='echo-v3-media-staging')<>1 then
    raise exception 'V3_STAGING_OWNER_A_READ_FAILED';
  end if;

  refused:=false;
  begin
    insert into storage.objects(bucket_id,name) values(
      'echo-v3-media-staging',
      '22222222-2222-2222-2222-222222222222/v3/'||
        recordhash||'/'||assethash||'/'||contenthash||'.png');
  exception when insufficient_privilege then refused:=true;
  end;
  if not refused then raise exception 'V3_STAGING_FOREIGN_ACCOUNT_UPLOAD_ALLOWED'; end if;

  refused:=false;
  begin
    insert into storage.objects(bucket_id,name) values(
      'echo-v3-media-staging',
      '11111111-1111-1111-1111-111111111111/v3/'||
        recordhash||'/'||assethash||'/wrong-name.png');
  exception when insufficient_privilege then refused:=true;
  end;
  if not refused then raise exception 'V3_STAGING_UNHASHED_FILENAME_ALLOWED'; end if;

  refused:=false;
  begin
    insert into storage.objects(bucket_id,name) values(
      'echo-v3-media-staging',
      repeat('e',64)||'/v3/'||recordhash||'/'||assethash||'/'||contenthash||'.png');
  exception when insufficient_privilege then refused:=true;
  end;
  if not refused then raise exception 'V3_STAGING_LEGACY_BEARER_PREFIX_ALLOWED'; end if;
end;
$a$;

set local request.jwt.claim.sub='22222222-2222-2222-2222-222222222222';
do $b$
declare visible_count int; refused boolean:=false;
begin
  select count(*) into visible_count from storage.objects
    where bucket_id='echo-v3-media-staging';
  if visible_count<>0 then raise exception 'V3_STAGING_CROSS_ACCOUNT_READ_ALLOWED'; end if;
  begin
    insert into storage.objects(bucket_id,name) values(
      'echo-v3-media-staging',
      '11111111-1111-1111-1111-111111111111/v3/'||
        repeat('a',64)||'/'||repeat('b',64)||'/'||repeat('d',64)||'.png');
  exception when insufficient_privilege then refused:=true;
  end;
  if not refused then raise exception 'V3_STAGING_SWITCHED_ACCOUNT_CAN_WRITE_OLD_PATH'; end if;
end;
$b$;

set local role anon;
do $anonymous$
declare n int; refused boolean:=false;
begin
  select count(*) into n from storage.objects where bucket_id='echo-v3-media-staging';
  if n<>0 then raise exception 'V3_STAGING_ANONYMOUS_READ_ALLOWED'; end if;
  begin
    insert into storage.objects(bucket_id,name) values(
      'echo-v3-media-staging',
      '11111111-1111-1111-1111-111111111111/v3/'||
        repeat('a',64)||'/'||repeat('b',64)||'/'||repeat('d',64)||'.jpg');
  exception when insufficient_privilege then refused:=true;
  end;
  if not refused then raise exception 'V3_STAGING_ANONYMOUS_UPLOAD_ALLOWED'; end if;
end;
$anonymous$;

rollback;
select 'PASS: staging private, account RLS, immutable hashed media; anonymous and owner-key-only clients denied' as result;
