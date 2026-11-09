-- Disposable Postgres 17: prove server-enforced per-owner V2/V3 cutover.
-- Nothing below is executed against the production project.

begin;
set local role anon;
set local request.headers = '{"x-live-memory-owner-key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';
insert into public.echo_passkey_records(owner_key,id,payload)
values('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
       'fence-personal','{"id":"fence-personal","title":"V2 before cutover"}'::jsonb);
do $pre$
begin
 if public.live_memory_v3_mode_personal() <> 'v2' then
   raise exception 'V3_MODE_ALREADY_ACTIVE';
 end if;
end;
$pre$;
select public.live_memory_v3_activate_personal();
select public.live_memory_v3_activate_personal(); -- idempotent
do $verify$
declare blocked boolean:=false; n bigint; mode text;
begin
 select public.live_memory_v3_mode_personal() into mode;
 if mode <> 'v3' then raise exception 'V3_ACTIVATION_FAILED'; end if;
 begin
   update public.echo_passkey_records set payload='{"id":"fence-personal","title":"V2 overwrite"}'::jsonb
   where id='fence-personal';
 exception when insufficient_privilege then
   if sqlerrm not like '%V3_LEGACY_WRITE_FENCED%' then raise; end if;
   blocked:=true;
 end;
 if not blocked then raise exception 'V3_LEGACY_WRITER_ESCAPED_FENCE'; end if;
 select v3_revision into n from public.live_memory_v3_cas_personal(
   'fence-personal', '{"id":"fence-personal","title":"CAS update"}'::jsonb,1);
 if n <> 2 then raise exception 'V3_FENCED_CAS_FAILED'; end if;
 -- The CAS must clear its temporary writer token before returning.
 blocked:=false;
 begin
   update public.echo_passkey_records set payload='{"id":"fence-personal","title":"V2 after CAS"}'::jsonb
   where id='fence-personal';
 exception when insufficient_privilege then
   if sqlerrm not like '%V3_LEGACY_WRITE_FENCED%' then raise; end if;
   blocked:=true;
 end;
 if not blocked then raise exception 'V3_WRITER_TOKEN_LEAKED'; end if;
end;
$verify$;
set local request.headers = '{"x-live-memory-owner-key":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}';
do $other$
begin
 if public.live_memory_v3_mode_personal() <> 'v2' then
   raise exception 'V3_PERSONAL_OWNER_CROSSOVER';
 end if;
 insert into public.echo_passkey_records(owner_key,id,payload)
 values ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
 'fence-personal-b','{"id":"fence-personal-b","title":"Other owner remains V2"}'::jsonb);
 if exists(select 1 from public.live_memory_v3_writer_modes
           where identity='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') then
   raise exception 'V3_MODE_RLS_BROKEN';
 end if;
end;
$other$;
rollback;

begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
insert into public.echo_text_backups(user_id,id,payload)
values ('11111111-1111-1111-1111-111111111111'::uuid,'fence-account',
        '{"id":"fence-account","title":"V2 before cutover","media":[]}'::jsonb);
select public.live_memory_v3_activate_account();
do $account$
declare blocked boolean:=false; n bigint;
begin
 if public.live_memory_v3_mode_account() <> 'v3' then
   raise exception 'V3_ACCOUNT_ACTIVATION_FAILED';
 end if;
 begin
   update public.echo_text_backups set payload='{"id":"fence-account","title":"V2 overwrite","media":[]}'::jsonb
     where id='fence-account';
 exception when insufficient_privilege then
   if sqlerrm not like '%V3_LEGACY_WRITE_FENCED%' then raise; end if;
   blocked:=true;
 end;
 if not blocked then raise exception 'V3_ACCOUNT_LEGACY_WRITER_ESCAPED'; end if;
 select v3_revision into n from public.live_memory_v3_cas_account(
   'fence-account','{"id":"fence-account","title":"V3 CAS","media":[]}'::jsonb,1);
 if n <> 2 then raise exception 'V3_ACCOUNT_CAS_FAILED'; end if;
 blocked:=false;
 begin
   update public.echo_text_backups set updated_at=now() where id='fence-account';
 exception when insufficient_privilege then
   blocked:=true;
 end;
 if not blocked then raise exception 'V3_ACCOUNT_WRITER_TOKEN_LEAKED'; end if;
end;
$account$;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $account_other$
begin
 if public.live_memory_v3_mode_account() <> 'v2' then raise exception 'V3_ACCOUNT_SCOPE_LEAK'; end if;
 insert into public.echo_text_backups(user_id,id,payload)
 values ('22222222-2222-2222-2222-222222222222'::uuid,
 'account-other','{"id":"account-other","title":"V2 other owner","media":[]}'::jsonb);
end;
$account_other$;
rollback;

select 'V3 server owner cutover and legacy-write fence passed' as result;
