-- V3 private Storage must not be a writable dumping ground for legacy
-- passkey credentials before an independently reviewed owner cutover.
-- No owner is activated by this migration. Legacy V2 media remains untouched.
--
-- Prerequisite: no existing V3 private object may lose visibility. If objects
-- were staged before this gate, stop and audit them first instead of hiding
-- user data under stricter RLS.
do $preflight$
begin
  if exists (select 1 from storage.objects where bucket_id='echo-private-media-v3') then
    raise exception 'V3_STORAGE_CUTOVER_GATE_REQUIRES_MEDIA_AUDIT'
      using errcode='55000';
  end if;
  if not exists (select 1 from storage.buckets
                 where id='echo-private-media-v3' and public=false) then
    raise exception 'V3_PRIVATE_STORAGE_BUCKET_INVALID' using errcode='42501';
  end if;
end;
$preflight$;

drop policy if exists "v3 private media owner insert" on storage.objects;
drop policy if exists "v3 private media owner read" on storage.objects;

create policy "v3 private media owner insert" on storage.objects
for insert to anon,authenticated
with check (
  bucket_id='echo-private-media-v3'
  and public.live_memory_owner_key() ~ '^[a-f0-9]{64}$'
  and (storage.foldername(name))[1] = pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      'live-memory-v3-media:' || public.live_memory_owner_key(), 'UTF8'
    )), 'hex'
  )
  and (storage.foldername(name))[2] = 'v3'
  and exists(
    select 1 from public.live_memory_v3_writer_modes
    where provider='personal' and identity=public.live_memory_owner_key()
  )
);

create policy "v3 private media owner read" on storage.objects
for select to anon,authenticated
using (
  bucket_id='echo-private-media-v3'
  and public.live_memory_owner_key() ~ '^[a-f0-9]{64}$'
  and (storage.foldername(name))[1] = pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      'live-memory-v3-media:' || public.live_memory_owner_key(), 'UTF8'
    )), 'hex'
  )
  and (storage.foldername(name))[2] = 'v3'
  and exists(
    select 1 from public.live_memory_v3_writer_modes
    where provider='personal' and identity=public.live_memory_owner_key()
  )
);
-- Intentionally no update or delete policy. Private assets are immutable.
