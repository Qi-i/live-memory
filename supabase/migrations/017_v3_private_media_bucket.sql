-- Live Memory V3 private images: additive new bucket, NEVER change V2's
-- existing public echo-media bucket or its legacy objects/policies.
-- This script does not upload/delete/migrate any user's pictures.
--
-- V3 clients MUST use this dedicated bucket, not settings.supabase.mediaBucket.
-- Missing/wrong bucket state is a deployment blocker; refuse to enable writes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'echo-private-media-v3',
  'echo-private-media-v3',
  false,
  33554432,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif']::text[]
)
on conflict (id) do nothing;

do $safety$
begin
  if (select public from storage.buckets where id = 'echo-private-media-v3')
       is distinct from false then
    raise exception 'V3_PRIVATE_MEDIA_BUCKET_NOT_PRIVATE' using errcode = '42501';
  end if;
end;
$safety$;

-- Unlike legacy V2, the new bucket has NO policy for public read,
-- overwrites or direct deletes. Access requires the current owner secret
-- in the header and a matching immutable owner prefix in the path.
alter table storage.objects enable row level security;

do $policies$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage'
      and tablename = 'objects' and policyname = 'v3 private media owner insert') then
    create policy "v3 private media owner insert" on storage.objects
    for insert to anon, authenticated
    with check (
      bucket_id = 'echo-private-media-v3'
      and (storage.foldername(name))[1] = public.live_memory_owner_key()
      and public.live_memory_owner_key() ~ '^[a-f0-9]{64}$'
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage'
      and tablename = 'objects' and policyname = 'v3 private media owner read') then
    create policy "v3 private media owner read" on storage.objects
    for select to anon, authenticated
    using (
      bucket_id = 'echo-private-media-v3'
      and (storage.foldername(name))[1] = public.live_memory_owner_key()
      and public.live_memory_owner_key() ~ '^[a-f0-9]{64}$'
    );
  end if;
end;
$policies$;

-- There is deliberately NO UPDATE/DELETE policy for this new bucket.
-- Old objects are immutable and orphan cleanup requires a separately
-- reviewed delayed reference sweep, not upload-time deletion.
