-- Additive, account-JWT-scoped private staging for the 40 legacy public
-- images. Staging does NOT activate V3 writer modes, copy V2 records, rotate
-- credentials, overwrite/delete original images, or authorize a final cutover.
--
-- The staged path begins with the authenticated user UUID (NOT a bearer key).
-- Content hash and immutable names support resumable, idempotent copying.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('echo-v3-media-staging','echo-v3-media-staging',false,33554432,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif']::text[])
on conflict(id) do nothing;

do $bucket$
begin
  if not exists(select 1 from storage.buckets
    where id='echo-v3-media-staging' and public=false
      and file_size_limit=33554432) then
    raise exception 'V3_STAGING_BUCKET_UNSAFE' using errcode='42501';
  end if;
  if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then
    raise exception 'V3_STAGING_OBJECT_RLS_REQUIRED' using errcode='42501';
  end if;
end;
$bucket$;

create policy "v3 authenticated media staging owner insert" on storage.objects
for insert to authenticated
with check (
  bucket_id='echo-v3-media-staging'
  and (select auth.uid()) is not null
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and (storage.foldername(name))[2]='v3'
  and (storage.foldername(name))[3] ~ '^[a-f0-9]{64}$'
  and (storage.foldername(name))[4] ~ '^[a-f0-9]{64}$'
  and storage.filename(name) ~ '^[a-f0-9]{64}\.(jpg|png|webp|gif|avif)$'
);

create policy "v3 authenticated media staging owner read" on storage.objects
for select to authenticated
using (
  bucket_id='echo-v3-media-staging'
  and (select auth.uid()) is not null
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and (storage.foldername(name))[2]='v3'
  and (storage.foldername(name))[3] ~ '^[a-f0-9]{64}$'
  and (storage.foldername(name))[4] ~ '^[a-f0-9]{64}$'
  and storage.filename(name) ~ '^[a-f0-9]{64}\.(jpg|png|webp|gif|avif)$'
);
-- No UPDATE or DELETE policy: once staged, original content-addressed media
-- cannot be replaced by a different client or silently erased.
