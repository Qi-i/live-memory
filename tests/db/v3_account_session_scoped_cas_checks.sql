-- Isolated PostgreSQL only. These are synthetic account identities and
-- archive rows. The entire test is rolled back, with no production access.
begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';

do $before$
declare refused boolean:=false;
begin
  begin
    perform public.live_memory_v3_cas_account_scoped(
      'session-test','{"id":"session-test","title":"wrong account","media":[]}'::jsonb,
      null,'22222222-2222-2222-2222-222222222222'::uuid);
  exception when insufficient_privilege then
    if sqlerrm like '%V3_ACCOUNT_SESSION_CHANGED%' then refused:=true; else raise; end if;
  end;
  if not refused then raise exception 'SESSION_SCOPED_CAS_ACCEPTED_WRONG_IDENTITY'; end if;

  refused:=false;
  begin
    perform public.live_memory_v3_cas_account_scoped(
      'session-test','{"id":"session-test","title":"not activated","media":[]}'::jsonb,
      null,'11111111-1111-1111-1111-111111111111'::uuid);
  exception when insufficient_privilege then
    if sqlerrm like '%V3_OWNER_NOT_ACTIVATED%' then refused:=true; else raise; end if;
  end;
  if not refused then raise exception 'SESSION_SCOPED_CAS_BYPASSED_ACTIVATION'; end if;
end;
$before$;

select public.live_memory_v3_activate_account();

do $after$
declare row_data record;
begin
  select * into row_data from public.live_memory_v3_cas_account_scoped(
    'session-test','{"id":"session-test","title":"account A only","media":[]}'::jsonb,
    null,'11111111-1111-1111-1111-111111111111'::uuid);
  if row_data.v3_revision<>1 then raise exception 'SCOPED_CAS_CREATE_FAILED'; end if;
end;
$after$;

set local request.jwt.claim.sub='22222222-2222-2222-2222-222222222222';
do $switched$
declare refused boolean:=false;
begin
  begin
    perform public.live_memory_v3_cas_account_scoped(
      'session-test','{"id":"session-test","title":"stolen A draft","media":[]}'::jsonb,
      null,'11111111-1111-1111-1111-111111111111'::uuid);
  exception when insufficient_privilege then
    if sqlerrm like '%V3_ACCOUNT_SESSION_CHANGED%' then refused:=true; else raise; end if;
  end;
  if not refused then raise exception 'SCOPED_CAS_COPIED_A_DRAFT_TO_B'; end if;
  if exists (select 1 from public.echo_text_backups where id='session-test') then
    raise exception 'SCOPED_CAS_EXPOSED_A_RECORD_TO_B';
  end if;
  if exists(select 1 from public.live_memory_v3_writer_modes where identity=
    '22222222-2222-2222-2222-222222222222') then
    raise exception 'SCOPED_CAS_ACTIVATED_OTHER_USER';
  end if;
end;
$switched$;
rollback;

select 'V3 account-scoped CAS rejects auth switches, preserves tenant and cutover fences' as result;
