-- V3 privacy hardening. The V2 ownerKey is an authorization credential,
-- and MUST NEVER appear literally in an image object path or signed URL.
--
-- The new public path identifier is a domain-separated SHA-256 of that key.
-- The Storage RLS policy hashes the private ownerKey request header itself:
-- copying a path prefix from an image URL is NOT sufficient authorization.
--
-- Strict precondition: V3 is still pre-cutover and this private bucket is empty.
-- If that changes, DO NOT re-key in place; perform an audited object migration.
do $v3_preflight$
begin
  if exists (
    select 1 from storage.objects where bucket_id='echo-private-media-v3'
  ) then
    raise exception 'V3_MEDIA_PREFIX_REKEY_REQUIRES_OBJECT_MIGRATION'
      using errcode='55000';
  end if;
  if not exists (
    select 1 from storage.buckets where id='echo-private-media-v3' and public=false
  ) then
    raise exception 'V3_PRIVATE_BUCKET_MISSING_OR_PUBLIC' using errcode='42501';
  end if;
end;
$v3_preflight$;

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
);
-- No UPDATE or DELETE policies: immutable content-addressed V3 uploads.
-- The legacy V2 public echo-media bucket/policies are not changed here.
