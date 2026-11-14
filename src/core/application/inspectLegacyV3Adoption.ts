import type { EventRecord, MediaAsset } from "../../domain";
import { canonicalRecord, stableSerialize } from "../sync/revision";

function mediaMetadata(asset:MediaAsset){
  const { src: _src, storagePath: _path, source: _source, ...rest }=asset;
  return rest;
}
function sameTransportIndependentMedia(a:readonly MediaAsset[],b:readonly MediaAsset[]):boolean{
  if(a.length!==b.length)return false;
  const map=new Map<string,MediaAsset>();
  for(const asset of a){
    if(!asset.id||map.has(asset.id))return false;
    map.set(asset.id,asset);
  }
  const used=new Set<string>();
  for(const asset of b){
    const old=map.get(asset.id);
    if(!old||used.has(asset.id)||
       stableSerialize(mediaMetadata(old))!==stableSerialize(mediaMetadata(asset))){
      return false;
    }
    used.add(asset.id);
    // A newly edited inline image is not proof of an uploaded original.
    if(/^(?:blob:|data:)/i.test(old.src)&&!old.storagePath)return false;
    if(old.storagePath && !asset.storagePath)return false;
    if(!asset.storagePath && old.src!==asset.src)return false;
  }
  return used.size===map.size;
}

export interface LegacyV3AdoptionInspection {
  records:number;
  changed:number;
}

/**
 * Narrow, single-account local V2 -> already-migrated V3 transport adoption.
 * Preserves ALL original content, timestamps, media metadata and tombstones;
 * only old media locations (and their signed transport URLs) may change.
 * Any unsynced local edit or new record aborts the complete operation.
 */
export function inspectLegacyV3Adoption(
  local:readonly EventRecord[], cloud:readonly EventRecord[],
):LegacyV3AdoptionInspection{
  if(!local.length||local.length!==cloud.length)throw Error("V3_ADOPTION_INVENTORY_MISMATCH");
  const ids=new Map<string,EventRecord>();
  for(const item of local){
    if(!item.id||ids.has(item.id))throw Error("V3_ADOPTION_BAD_LOCAL_IDS");
    ids.set(item.id,item);
  }
  const cloudIds=new Set<string>();
  let changed=0;
  for(const next of cloud){
    const old=ids.get(next.id);
    if(!old||cloudIds.has(next.id))throw Error("V3_ADOPTION_CLOUD_ID_MISMATCH");
    cloudIds.add(next.id);
    if(stableSerialize(canonicalRecord(old,false))!==
       stableSerialize(canonicalRecord(next,false)) ||
       old.updatedAt!==next.updatedAt ||
       old.createdAt!==next.createdAt ||
       old.deletedAt!==next.deletedAt ||
       !sameTransportIndependentMedia(old.media,next.media)){
      throw Error("V3_ADOPTION_LOCAL_UNSYNCED_HISTORY");
    }
    if(stableSerialize(canonicalRecord(old,true))!==
       stableSerialize(canonicalRecord(next,true)))changed++;
  }
  return {records:local.length,changed};
}
