-- One-time, database-administrator-operated adoption of the proven single
-- account. No JSON downloads, no client export, no password or bearer ownerKey.
-- Intentionally NOT a public RPC, grant, migration trigger, or service endpoint.
-- Run only AFTER migration 027 and V3 browser code have passed deployment CI.
-- Existing V2 and old media remain untouched as independent rollback sources.
-- Atomic transaction: ANY missing source/asset, divergent row or inconsistent
-- inventory aborts every mirror insert and the final writer activation.
do $adopt$
declare
  v_user uuid;
  v_source record;
  v_asset jsonb;
  v_media jsonb;
  v_payload jsonb;
  v_path text;
  v_prefix text;
  v_sources integer;
  v_private integer:=0;
  v_external integer:=0;
  v_imported integer:=0;
  v_existing jsonb;
begin
  if (select count(distinct user_id) from public.echo_text_backups) <> 1 then
    raise exception 'V3_ADMIN_MULTIPLE_ACCOUNT_IDENTITIES';
  end if;
  select user_id into strict v_user from public.echo_text_backups limit 1;
  -- Prevent V2 account commits during the provenance snapshot and promotion.
  perform pg_advisory_xact_lock(hashtextextended('lm-v3|account|'||v_user::text,0));
  lock table public.echo_text_backups in share mode;
  lock table public.echo_passkey_records in share mode;
  if exists(select 1 from public.live_memory_v3_writer_modes
     where provider='account' and identity=v_user::text) then
    raise exception 'V3_ADMIN_ALREADY_ACTIVE';
  end if;

  select count(*) into v_sources from public.echo_text_backups
    where user_id=v_user;
  if v_sources<>36 then
    raise exception 'V3_ADMIN_UNEXPECTED_LEGACY_INVENTORY';
  end if;
  -- Every account-backed ID must have exactly one full-media personal history
  -- with identical non-media fields, deletion state and update timestamp.
  if exists(
    select 1 from public.echo_text_backups t
    left join lateral (
      select count(*) n from public.echo_passkey_records r
      where r.id=t.id
        and (r.payload-'media'-'mediaTombstones'-'syncedAt')=
            (t.payload-'media'-'mediaTombstones'-'syncedAt')
        and r.deleted_at is not distinct from t.deleted_at
        and r.updated_at is not distinct from t.updated_at
    ) matches on true
    where t.user_id=v_user and matches.n<>1
  ) then raise exception 'V3_ADMIN_SOURCE_PROVENANCE_AMBIGUOUS'; end if;

  -- This administrative operation is account-scoped; the existing CAS RPC
  -- still performs record validation, storage checks and conflict control.
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  if (select auth.uid()) is distinct from v_user then
    raise exception 'V3_ADMIN_SCOPE_NOT_ESTABLISHED';
  end if;

  for v_source in
    select r.id,r.payload from public.echo_text_backups t
    join public.echo_passkey_records r on r.id=t.id
      and r.payload-'media'-'mediaTombstones'-'syncedAt'=
          t.payload-'media'-'mediaTombstones'-'syncedAt'
      and r.deleted_at is not distinct from t.deleted_at
      and r.updated_at is not distinct from t.updated_at
    where t.user_id=v_user order by r.id
  loop
    v_media:='[]'::jsonb;
    for v_asset in select value from jsonb_array_elements(v_source.payload->'media')
    loop
      if coalesce(v_asset->>'recordId','')<>v_source.id or
         coalesce(v_asset->>'id','')='' then
        raise exception 'V3_ADMIN_INVALID_ASSET_ID';
      end if;
      if coalesce(v_asset->>'storagePath','')<>'' then
        v_prefix:=v_user::text||'/v3/'||
          encode(sha256(convert_to(v_source.id,'UTF8')),'hex')||'/'||
          encode(sha256(convert_to(v_asset->>'id','UTF8')),'hex')||'/';
        if (select count(*) from storage.objects o
            where o.bucket_id='echo-v3-media-staging'
              and left(o.name,length(v_prefix))=v_prefix)<>1 then
          raise exception 'V3_ADMIN_PRIVATE_MEDIA_NOT_UNIQUE';
        end if;
        select o.name into strict v_path from storage.objects o
          where o.bucket_id='echo-v3-media-staging'
            and left(o.name,length(v_prefix))=v_prefix;
        if v_path !~ ('^'||v_prefix||'[a-f0-9]{64}[.](jpg|png|webp|gif|avif)$') then
          raise exception 'V3_ADMIN_PRIVATE_MEDIA_PATH_INVALID';
        end if;
        v_asset:=v_asset||jsonb_build_object(
          'storagePath',v_path,'src','','source','supabase');
        v_private:=v_private+1;
      elsif coalesce(v_asset->>'src','') ~
        '^https://img[.]alicdn[.]com/[^[:space:]]+$' then
        -- Historical external references are preserved, not represented as
        -- privately backed-up originals.
        v_external:=v_external+1;
      else raise exception 'V3_ADMIN_MEDIA_BYTES_OR_REFERENCE_MISSING';
      end if;
      v_media:=v_media||jsonb_build_array(v_asset);
    end loop;
    v_payload:=jsonb_set(v_source.payload,'{media}',v_media,true);
    select payload into v_existing
      from public.live_memory_v3_secure_records
      where user_id=v_user and id=v_source.id;
    if found then
      if v_existing<>v_payload then
        raise exception 'V3_ADMIN_PREEXISTING_MIRROR_CONFLICT';
      end if;
    else
      perform public.live_memory_v3_cas_secure_account(
        v_source.id,v_payload,null,v_user);
      v_imported:=v_imported+1;
    end if;
  end loop;

  if v_private<>41 or v_external<>18 or v_imported<>v_sources or
    (select count(*) from public.live_memory_v3_secure_records where user_id=v_user)<>v_sources
    or exists(
      select 1 from public.echo_text_backups t
      left join public.live_memory_v3_secure_records m
        on m.user_id=t.user_id and m.id=t.id
      where t.user_id=v_user and (
        m.id is null or (m.payload-'media'-'mediaTombstones'-'syncedAt') <>
          (t.payload-'media'-'mediaTombstones'-'syncedAt')
        or jsonb_array_length(m.payload->'media') <>
          jsonb_array_length(coalesce((select r.payload->'media'
            from public.echo_passkey_records r
            where r.id=t.id and
              r.payload-'media'-'mediaTombstones'-'syncedAt'=
                t.payload-'media'-'mediaTombstones'-'syncedAt'), '[]'::jsonb))
      )
    ) then
    raise exception 'V3_ADMIN_FINAL_READBACK_MISMATCH';
  end if;

  -- Database-level owner/writer fence; no self-approval rows or manual UI
  -- export are needed. The entire cutover rolls back if any assertion fails.
  perform set_config('live_memory.v3_activation_guard','1',true);
  insert into public.live_memory_v3_writer_modes(provider,identity)
    values('account',v_user::text);
  perform set_config('live_memory.v3_activation_guard','0',true);
  if not exists(select 1 from public.live_memory_v3_writer_modes
      where provider='account' and identity=v_user::text) then
    raise exception 'V3_ADMIN_ACTIVATION_NOT_COMMITTED';
  end if;
  raise notice 'V3_ADMIN_ACCOUNT_ADOPTED: % records, % private refs, % original CDN refs',
    v_sources,v_private,v_external;
end;
$adopt$;
