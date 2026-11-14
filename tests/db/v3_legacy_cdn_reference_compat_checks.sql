-- PostgreSQL 17 disposable instance only. Never modifies real account records.
begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';

do $cdn$
declare
  uid constant uuid:='11111111-1111-1111-1111-111111111111';
  legacy_url constant text:='https://img.alicdn.com/imgextra/i3/12345/poster.png?version=1';
  base jsonb;
  media jsonb;
  rejected boolean;
  committed record;
begin
  media:=jsonb_build_array(jsonb_build_object('id','legacy-poster',
    'recordId','historical-show','kind','poster','src',legacy_url));
  base:=jsonb_build_object('id','historical-show','media',media,
    'updatedAt','2026-11-14T00:00:00Z');
  select * into committed from public.live_memory_v3_cas_secure_account(
    'historical-show',base,null,uid);
  if committed.v3_revision<>1 or
     committed.payload->'media'->0->>'src'<>legacy_url then
    raise exception 'HISTORICAL_CDN_REFERENCE_DROPPED';
  end if;
  for media in
    select value from jsonb_array_elements(jsonb_build_array(
      jsonb_set(base,'{media,0,src}','"https://different.example/p.jpg"'::jsonb),
      jsonb_set(base,'{media,0,src}','"http://img.alicdn.com/p.jpg"'::jsonb),
      jsonb_set(base,'{media,0,src}','"data:image/png;base64,abc"'::jsonb),
      jsonb_set(base,'{media,0,storagePath}','"forged-private-path"'::jsonb),
      jsonb_set(base,'{media,0,recordId}','"another-show"'::jsonb)
    ))
  loop
    rejected:=false;
    begin
      perform public.live_memory_v3_cas_secure_account(
        'historical-show',media,1,uid);
    exception when others then
      if sqlerrm like '%V3_SECURE_MEDIA_NOT_STAGED%' then rejected:=true;
      else raise; end if;
    end;
    if not rejected then raise exception 'UNVERIFIED_MEDIA_ACCEPTED'; end if;
  end loop;
  if (select v3_revision from public.live_memory_v3_secure_records
      where id='historical-show')<>1 then
    raise exception 'FAILED_MEDIA_CHANGED_ARCHIVE';
  end if;
end;
$cdn$;
rollback;
