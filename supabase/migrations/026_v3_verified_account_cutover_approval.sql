-- Never let an authenticated client switch legacy V2 into fenced V3 mode
-- before a full-media secure mirror, audited backup, image migration, and
-- source-ownership verification are independently approved.
--
-- This migration is ADDITIVE: no old media, V2 rows, existing mode markers,
-- or private mirror rows are changed. No account is activated.
create table if not exists public.live_memory_v3_cutover_approvals (
  user_id uuid primary key,
  legacy_digest text not null check(legacy_digest ~ '^[a-f0-9]{64}$'),
  mirror_digest text not null check(mirror_digest ~ '^[a-f0-9]{64}$'),
  full_backup_verified boolean not null default false,
  media_bytes_verified boolean not null default false,
  personal_sources_verified boolean not null default false,
  approved_at timestamptz not null default now()
);
alter table public.live_memory_v3_cutover_approvals enable row level security;
create policy "v3 account sees own cutover approval"
on public.live_memory_v3_cutover_approvals for select to authenticated
using (user_id=(select auth.uid()));
revoke all on public.live_memory_v3_cutover_approvals from public,anon,authenticated;
grant select on public.live_memory_v3_cutover_approvals to authenticated;

-- All digests are computed on server-visible RLS-scoped rows. The digest of
-- each row covers both its CAS revision and the exact JSON payload, so ANY
-- old-client modification after approval invalidates the promotion.
create or replace function public.live_memory_v3_secure_account_readiness()
returns table(
  legacy_digest text,mirror_digest text,
  legacy_count bigint,mirror_count bigint,missing_legacy_count bigint
)
language sql stable security invoker set search_path=pg_catalog
as $readiness$
  select
    (select encode(sha256(convert_to(coalesce(string_agg(
      encode(sha256(convert_to(
        jsonb_build_array(id,v3_revision,payload)::text,'UTF8'
      )),'hex'),',' order by id),'') ,'UTF8')),'hex')
      from public.echo_text_backups
      where user_id=(select auth.uid())),
    (select encode(sha256(convert_to(coalesce(string_agg(
      encode(sha256(convert_to(
        jsonb_build_array(id,v3_revision,payload)::text,'UTF8'
      )),'hex'),',' order by id),'') ,'UTF8')),'hex')
      from public.live_memory_v3_secure_records
      where user_id=(select auth.uid())),
    (select count(*) from public.echo_text_backups
      where user_id=(select auth.uid())),
    (select count(*) from public.live_memory_v3_secure_records
      where user_id=(select auth.uid())),
    (select count(*) from public.echo_text_backups as old
      where old.user_id=(select auth.uid())
        and not exists(select 1 from public.live_memory_v3_secure_records as secure
          where secure.user_id=old.user_id and secure.id=old.id));
$readiness$;

revoke all on function public.live_memory_v3_secure_account_readiness()
from public,anon;
grant execute on function public.live_memory_v3_secure_account_readiness()
to authenticated;

-- Direct POST to writer_modes must not bypass the approval procedure, even
-- though account users have an existing RLS INSERT policy for their own UUID.
create or replace function public.live_memory_v3_mode_lock()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $mode$
begin
  if new.provider='account' and
     current_setting('live_memory.v3_activation_guard',true) is distinct from '1' then
    raise exception 'V3_ACCOUNT_ACTIVATION_GUARD_REQUIRED' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('lm-v3|'||new.provider||'|'||new.identity,0)
  );
  return new;
end;
$mode$;

create or replace function public.live_memory_v3_activate_account()
returns text language plpgsql security invoker set search_path=pg_catalog
as $activate$
declare
  v_user uuid := (select auth.uid());
  v_state record;
  v_approval record;
begin
  if v_user is null then
    raise exception 'V3_UNAUTHORIZED' using errcode='42501';
  end if;

  -- Acquiring the exact same lock as legacy V2's revision trigger prevents
  -- a V2 blind write from arriving between snapshot check and writer fencing.
  perform pg_advisory_xact_lock(
    hashtextextended('lm-v3|account|'||v_user::text,0)
  );

  -- Secure-account CAS uses per-record locks, not the old V2 owner lock.
  -- A concurrent mirror INSERT/UPDATE could otherwise land after the
  -- approval digest was read but before the writer marker was created.
  -- SHARE conflicts with their ROW EXCLUSIVE DML locks until commit.
  -- This is a rare promotion-only lock; it changes no archive contents.
  lock table public.live_memory_v3_secure_records in share mode;

  select * into v_state
  from public.live_memory_v3_secure_account_readiness();
  select * into v_approval
  from public.live_memory_v3_cutover_approvals
  where user_id=v_user;

  if not found or not coalesce(v_approval.full_backup_verified,false)
     or not coalesce(v_approval.media_bytes_verified,false)
     or not coalesce(v_approval.personal_sources_verified,false) then
    raise exception 'V3_ACCOUNT_CUTOVER_NOT_APPROVED' using errcode='42501';
  end if;
  if v_state.mirror_count<1 or v_state.missing_legacy_count<>0
     or v_approval.legacy_digest is distinct from v_state.legacy_digest
     or v_approval.mirror_digest is distinct from v_state.mirror_digest then
    raise exception 'V3_ACCOUNT_CUTOVER_ARCHIVE_CHANGED' using errcode='42501';
  end if;

  perform set_config('live_memory.v3_activation_guard','1',true);
  insert into public.live_memory_v3_writer_modes(provider,identity)
  values('account',v_user::text) on conflict do nothing;
  perform set_config('live_memory.v3_activation_guard','0',true);
  return 'v3';
end;
$activate$;

revoke all on function public.live_memory_v3_activate_account()
from public,anon;
grant execute on function public.live_memory_v3_activate_account()
to authenticated;
