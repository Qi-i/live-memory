-- Disposable PostgreSQL 17 only. After migration 020, no V3 CAS may
-- write until a verified owner-level cutover marker is committed.
begin;
set local role anon;
set local request.headers='{"x-live-memory-owner-key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';
do $personal_pre$
declare denied boolean:=false;
begin
  if public.live_memory_v3_mode_personal()<>'v2' then raise exception 'PERSONAL_PRE_MIGRATED'; end if;
  begin
    perform public.live_memory_v3_cas_personal(
      'guard-personal','{"id":"guard-personal","title":"FORBIDDEN"}'::jsonb,null);
  exception when insufficient_privilege then
    if sqlerrm like '%V3_OWNER_NOT_ACTIVATED%' then denied:=true;
    else raise; end if;
  end;
  if not denied then raise exception 'V3_PRE_CUTOVER_PERSONAL_CAS_ALLOWED'; end if;
  denied:=false;
  begin
    perform public.live_memory_v3_activate_personal();
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'ANON_PERSONAL_OWNER_ACTIVATION_ALLOWED'; end if;
  denied:=false;
  begin
    insert into public.live_memory_v3_writer_modes(provider,identity)
    values('personal',repeat('a',64));
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'ANON_DIRECT_MARKER_INSERT_ALLOWED'; end if;
  -- The existing V2 writer continues working until explicit cutover.
  insert into public.echo_passkey_records(owner_key,id,payload)
  values(repeat('a',64),'guard-v2-still-live','{"id":"guard-v2-still-live"}'::jsonb);
end;
$personal_pre$;
set local role postgres;
select public.live_memory_v3_activate_personal();
set local role anon;
do $personal_post$
declare n bigint; blocked boolean:=false;
begin
  if public.live_memory_v3_mode_personal()<>'v3' then raise exception 'PERSONAL_CUTOVER_FAILED'; end if;
  select v3_revision into n from public.live_memory_v3_cas_personal(
    'guard-personal','{"id":"guard-personal","title":"V3 CAS ONLY"}'::jsonb,null);
  if n<>1 then raise exception 'PERSONAL_CAS_AFTER_CUTOVER_FAILED'; end if;
  begin
    update public.echo_passkey_records set updated_at=now()
      where id='guard-personal';
  exception when insufficient_privilege then
    if sqlerrm like '%V3_LEGACY_WRITE_FENCED%' then blocked:=true;
    else raise; end if;
  end;
  if not blocked then raise exception 'V2_PERSONAL_WRITER_AFTER_CUTOVER_ALLOWED'; end if;
end;
$personal_post$;
set local request.headers='{"x-live-memory-owner-key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
do $other_personal$
declare blocked boolean:=false;
begin
  begin
    perform public.live_memory_v3_cas_personal(
      'guard-other-personal','{"id":"guard-other-personal","title":"FORBIDDEN"}'::jsonb,null);
  exception when insufficient_privilege then
    if sqlerrm like '%V3_OWNER_NOT_ACTIVATED%' then blocked:=true;
    else raise; end if;
  end;
  if not blocked then raise exception 'CROSS_OWNER_INHERITED_V3_CUTOVER'; end if;
end;
$other_personal$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
do $account_pre$
declare denied boolean:=false;
begin
  if public.live_memory_v3_mode_account()<>'v2' then raise exception 'ACCOUNT_PRE_MIGRATED'; end if;
  begin
    perform public.live_memory_v3_cas_account(
      'guard-account','{"id":"guard-account","media":[]}'::jsonb,null);
  exception when insufficient_privilege then
    if sqlerrm like '%V3_OWNER_NOT_ACTIVATED%' then denied:=true;
    else raise; end if;
  end;
  if not denied then raise exception 'V3_PRE_CUTOVER_ACCOUNT_CAS_ALLOWED'; end if;
  denied:=false;
  begin
    insert into public.live_memory_v3_writer_modes(provider,identity)
    values('personal',repeat('a',64));
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'AUTH_USER_PERSONAL_MARKER_INSERT_ALLOWED'; end if;
  insert into public.echo_text_backups(user_id,id,payload)
  values('11111111-1111-1111-1111-111111111111'::uuid,
   'guard-v2-account','{"id":"guard-v2-account","media":[]}'::jsonb);
end;
$account_pre$;
select public.live_memory_v3_activate_account();
do $account_post$
declare n bigint; blocked boolean:=false;
begin
  select v3_revision into n from public.live_memory_v3_cas_account(
    'guard-account','{"id":"guard-account","media":[],"title":"V3 CAS"}'::jsonb,null);
  if n<>1 then raise exception 'ACCOUNT_CAS_AFTER_CUTOVER_FAILED'; end if;
  begin
    update public.echo_text_backups set updated_at=now()
      where id='guard-account';
  exception when insufficient_privilege then
    if sqlerrm like '%V3_LEGACY_WRITE_FENCED%' then blocked:=true;
    else raise; end if;
  end;
  if not blocked then raise exception 'V2_ACCOUNT_WRITER_AFTER_CUTOVER_ALLOWED'; end if;
end;
$account_post$;
set local request.jwt.claim.sub='22222222-2222-2222-2222-222222222222';
do $account_other$
declare blocked boolean:=false;
begin
  begin
    perform public.live_memory_v3_cas_account(
      'guard-other-account','{"id":"guard-other-account","media":[]}'::jsonb,null);
  exception when insufficient_privilege then
    if sqlerrm like '%V3_OWNER_NOT_ACTIVATED%' then blocked:=true;
    else raise; end if;
  end;
  if not blocked then raise exception 'CROSS_ACCOUNT_INHERITED_V3_CUTOVER'; end if;
end;
$account_other$;
rollback;

select 'V3 preactivation CAS denied, legacy V2 preserved, activated CAS allowed, owner isolation verified' as result;
