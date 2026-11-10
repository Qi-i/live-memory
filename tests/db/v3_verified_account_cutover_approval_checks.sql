-- Disposable PostgreSQL only; synthetic accounts and approvals are rolled back.
begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';

do $before$
declare refused boolean:=false; current_mode text;
begin
  select public.live_memory_v3_mode_account() into current_mode;
  if current_mode<>'v2' then raise exception 'SYNTHETIC_OWNER_ALREADY_ACTIVATED'; end if;
  begin
    perform public.live_memory_v3_activate_account();
  exception when insufficient_privilege then
    if sqlerrm like '%V3_ACCOUNT_CUTOVER_NOT_APPROVED%' then refused:=true;
    else raise; end if;
  end;
  if not refused then raise exception 'PRE_APPROVAL_ACTIVATION_ALLOWED'; end if;

  refused:=false;
  begin
    insert into public.live_memory_v3_writer_modes(provider,identity)
    values('account','11111111-1111-1111-1111-111111111111');
  exception when insufficient_privilege then
    if sqlerrm like '%V3_ACCOUNT_ACTIVATION_GUARD_REQUIRED%' then refused:=true;
    else raise; end if;
  end;
  if not refused then raise exception 'DIRECT_MODE_INSERT_BYPASSED_APPROVAL'; end if;

  refused:=false;
  begin
    insert into public.live_memory_v3_cutover_approvals(
      user_id,legacy_digest,mirror_digest,full_backup_verified,
      media_bytes_verified,personal_sources_verified)
    values('11111111-1111-1111-1111-111111111111',
      repeat('a',64),repeat('b',64),true,true,true);
  exception when insufficient_privilege then refused:=true; end;
  if not refused then raise exception 'CLIENT_SELF_APPROVED_CUTOVER'; end if;
end;
$before$;

-- Legacy V2 remains writable while the secure mirror is being staged.
insert into public.echo_text_backups(user_id,id,payload)
values('11111111-1111-1111-1111-111111111111','old-one',
  '{"id":"old-one","title":"V2 original","media":[]}'::jsonb);

-- A separate administrator is the ONLY authority able to record proof that
-- the full backup, source-identity mapping and original media are verified.
set local role postgres;
insert into public.live_memory_v3_cutover_approvals(
  user_id,legacy_digest,mirror_digest,full_backup_verified,
  media_bytes_verified,personal_sources_verified)
select '11111111-1111-1111-1111-111111111111'::uuid,
  legacy_digest,mirror_digest,true,true,true
from public.live_memory_v3_secure_account_readiness();

set local role authenticated;
do $not_ready$
declare blocked boolean:=false;
begin
  begin
    perform public.live_memory_v3_activate_account();
  exception when insufficient_privilege then
    if sqlerrm like '%V3_ACCOUNT_CUTOVER_ARCHIVE_CHANGED%' then blocked:=true;
    else raise; end if;
  end;
  if not blocked then raise exception 'EMPTY_MIRROR_ALLOWED_ACTIVATION'; end if;
end;
$not_ready$;

-- Secure mirror gets a copy, but the earlier admin snapshot is now stale.
select * from public.live_memory_v3_cas_secure_account(
  'old-one','{"id":"old-one","title":"V2 original","media":[]}'::jsonb,
  null,'11111111-1111-1111-1111-111111111111'::uuid);

do $snapshot$
declare blocked boolean:=false;
begin
  begin
    perform public.live_memory_v3_activate_account();
  exception when insufficient_privilege then
    if sqlerrm like '%V3_ACCOUNT_CUTOVER_ARCHIVE_CHANGED%' then blocked:=true;
    else raise; end if;
  end;
  if not blocked then raise exception 'STALE_APPROVAL_ACCEPTED'; end if;
end;
$snapshot$;

-- Update approval snapshot, then prove a late V2 edit invalidates it too.
set local role postgres;
update public.live_memory_v3_cutover_approvals as approve
set mirror_digest=ready.mirror_digest,legacy_digest=ready.legacy_digest
from public.live_memory_v3_secure_account_readiness() as ready
where approve.user_id='11111111-1111-1111-1111-111111111111';

set local role authenticated;
update public.echo_text_backups
set payload='{"id":"old-one","title":"V2 change after backup","media":[]}'::jsonb
where id='old-one';

do $v2_drift$
declare blocked boolean:=false;
begin
  begin
    perform public.live_memory_v3_activate_account();
  exception when insufficient_privilege then
    if sqlerrm like '%V3_ACCOUNT_CUTOVER_ARCHIVE_CHANGED%' then blocked:=true;
    else raise; end if;
  end;
  if not blocked then raise exception 'LATE_LEGACY_EDIT_NOT_CAUGHT'; end if;
end;
$v2_drift$;

-- After independent reapproval of the exact new snapshots the server may
-- atomically fence V2; the cutover still cannot be triggered by stolen keys.
set local role postgres;
update public.live_memory_v3_cutover_approvals as approve
set mirror_digest=ready.mirror_digest,legacy_digest=ready.legacy_digest
from public.live_memory_v3_secure_account_readiness() as ready
where approve.user_id='11111111-1111-1111-1111-111111111111';

set local role authenticated;
do $final$
declare blocked boolean:=false;
begin
  if public.live_memory_v3_activate_account()<>'v3' then
    raise exception 'VERIFIED_ACCOUNT_ACTIVATION_FAILED';
  end if;
  if public.live_memory_v3_mode_account()<>'v3' then
    raise exception 'VERIFIED_WRITER_MARKER_NOT_VISIBLE';
  end if;
  if current_setting('live_memory.v3_activation_guard',true) is distinct from '0' then
    raise exception 'ACTIVATION_GUARD_TOKEN_LEAKED';
  end if;

  begin
    update public.echo_text_backups
    set payload='{"id":"old-one","title":"stale V2 write","media":[]}'::jsonb
    where id='old-one';
  exception when insufficient_privilege then
    if sqlerrm like '%V3_LEGACY_WRITE_FENCED%' then blocked:=true;
    else raise; end if;
  end;
  if not blocked then raise exception 'POST_CUTOVER_V2_WRITE_ALLOWED'; end if;
end;
$final$;

set local request.jwt.claim.sub='22222222-2222-2222-2222-222222222222';
do $other$
declare blocked boolean:=false;
begin
  if exists(select 1 from public.live_memory_v3_cutover_approvals) then
    raise exception 'ACCOUNT_B_READ_ACCOUNT_A_APPROVAL';
  end if;
  begin
    perform public.live_memory_v3_activate_account();
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'ACCOUNT_B_ACTIVATED_WITH_A_APPROVAL'; end if;
end;
$other$;

rollback;
select 'PASS: admin-only approval, snapshot-bound mirror, legacy-write lock, direct marker fence, tenant isolation' as result;
