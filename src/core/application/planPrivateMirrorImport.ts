import type { EventRecord, MediaAsset } from "../../domain";
import type { CloudRecordEnvelope } from "../ports/CloudRecordAdapter";
import {
  verifyPortableBackupDocument,
  type PortableBackupDocument,
  type PortableMediaEntry,
} from "./portableMediaBackup";
import { recordContentEqual } from "../sync/revision";

export interface PrivateMirrorImportPlan {
  userId: string;
  records: number;
  assets: number;
  bytes: number;
  alreadyPresent: number;
  toCreate: EventRecord[];
  /** Every source record, including those already in the mirror, must have its images re-verified. */
  allRecords: EventRecord[];
  mediaByKey: Map<string, PortableMediaEntry>;
}
const ACCOUNT=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const TYPES: Record<string,string> = {
  "image/jpeg":"jpg","image/png":"png","image/webp":"webp",
  "image/gif":"gif","image/avif":"avif",
};
const encoder=new TextEncoder();
async function hash(content: string): Promise<string> {
  const array=new Uint8Array(encoder.encode(content));
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",array.buffer as ArrayBuffer));
  return Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
}
function key(recordId:string,assetId:string){return JSON.stringify([recordId,assetId]);}

/** Proves all embedded image bytes against the portable manifest; maps every
 * image to the exact path authorized by the account's Storage and CAS RLS.
 * Any existing secure record whose semantic content differs blocks the
 * ENTIRE import before the first network write. No winner is guessed. */
export async function planPrivateMirrorImport(
  document: unknown,
  userIdInput: string,
  current: readonly CloudRecordEnvelope[],
): Promise<PrivateMirrorImportPlan> {
  const userId=userIdInput.toLowerCase();
  if(!ACCOUNT.test(userId))throw Error("V3_MIRROR_INVALID_ACCOUNT");
  const verified=await verifyPortableBackupDocument(document);
  const doc=document as PortableBackupDocument;
  const manifest=new Map<string,PortableMediaEntry>();
  for(const entry of doc.portableMediaManifest.assets){
    manifest.set(key(entry.recordId,entry.assetId),entry);
  }
  const existing=new Map<string,EventRecord>();
  for(const row of current){
    if(!row?.record?.id || existing.has(row.record.id) ||
       !/^[1-9]\d*$/.test(row.serverRevision) ||
       !Number.isSafeInteger(Number(row.serverRevision))) {
      throw Error("V3_MIRROR_INVALID_REMOTE_INVENTORY");
    }
    existing.set(row.record.id,row.record);
  }
  const wanted:EventRecord[]=[];
  const allRecords:EventRecord[]=[];
  let alreadyPresent=0;
  for(const record of doc.records) {
    const recordHash=await hash(record.id);
    const media:MediaAsset[]=[];
    for(const asset of record.media){
      if(asset.recordId!==record.id) throw Error("V3_MIRROR_MEDIA_RECORD_MISMATCH");
      const item=manifest.get(key(record.id,asset.id));
      if(!item)throw Error("V3_MIRROR_MEDIA_NOT_IN_MANIFEST");
      const extension=TYPES[item.mimeType.toLowerCase()];
      if(!extension)throw Error("V3_MIRROR_UNSUPPORTED_IMAGE_TYPE");
      media.push({
        ...asset,
        src:"",
        storagePath:userId+"/v3/"+recordHash+"/"+await hash(asset.id)+
          "/"+item.sha256+"."+extension,
      });
    }
    const desired:EventRecord={...record,media};
    allRecords.push(desired);
    const old=existing.get(record.id);
    if(old){
      if(!recordContentEqual(old,desired,true)){
        throw Error("V3_MIRROR_EXISTING_RECORD_CONFLICT");
      }
      alreadyPresent++;
    }else{
      wanted.push(desired);
    }
  }
  return {
    userId, records:verified.records, assets:verified.assets,
    bytes:verified.totalBytes, alreadyPresent,
    toCreate:wanted, allRecords, mediaByKey:manifest,
  };
}