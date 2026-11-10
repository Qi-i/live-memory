import type {EventRecord,MediaAsset} from "../../domain";
import type {CloudRecordEnvelope} from "../ports/CloudRecordAdapter";
import type {PortableBackupDocument} from "./portableMediaBackup";
import {planPrivateMirrorImport} from "./planPrivateMirrorImport";
import {recordContentEqual,stableSerialize} from "../sync/revision";

export interface PrivateMirrorImportIO {
  accountUserId:string;
  assertAccount():Promise<void>;
  list():Promise<CloudRecordEnvelope[]>;
  stageImage(asset:MediaAsset,expectedPath:string,expectedSha256:string):Promise<void>;
  create(record:EventRecord):Promise<CloudRecordEnvelope>;
}
export interface PrivateMirrorImportResult {
  total:number;
  mediaVerified:number;
  created:number;
  alreadyPresent:number;
}
function fingerprint(rows:readonly CloudRecordEnvelope[]):string {
  const list=[...rows].sort((a,b)=>a.record.id.localeCompare(b.record.id));
  return stableSerialize(list.map(row=>({
    id:row.record.id,version:row.serverRevision,content:row.record,
  })));
}

/** User-initiated, resumable copy to the NEW private archive only.
 * The original V2 account and personal records are never updated or deleted.
 * All content conflicts stop before any media upload; an optimistic create
 * race is resolved only if the winning record is content-identical.
 */
export async function importPortableBackupToSecureMirror(
  document:PortableBackupDocument,
  io:PrivateMirrorImportIO,
):Promise<PrivateMirrorImportResult>{
  await io.assertAccount();
  const first=await io.list();
  await io.assertAccount();
  const plan=await planPrivateMirrorImport(document,io.accountUserId,first);
  await io.assertAccount();
  const second=await io.list();
  await io.assertAccount();
  if(fingerprint(first)!==fingerprint(second)){
    throw Error("V3_MIRROR_REMOTE_CHANGED");
  }
  const pending=await planPrivateMirrorImport(document,io.accountUserId,second);
  if(pending.toCreate.length!==plan.toCreate.length ||
     pending.alreadyPresent!==plan.alreadyPresent){
    throw Error("V3_MIRROR_REMOTE_CHANGED");
  }
  let created=0,mediaVerified=0,alreadyPresent=plan.alreadyPresent;
  for(const record of plan.toCreate){
    await io.assertAccount();
    const original=document.records.find(row=>row.id===record.id);
    if(!original)throw Error("V3_MIRROR_BACKUP_CHANGED");
    for(const target of record.media){
      const source=original.media.find(asset=>asset.id===target.id);
      const item=plan.mediaByKey.get(JSON.stringify([record.id,target.id]));
      if(!source||!item||!target.storagePath)throw Error("V3_MIRROR_BACKUP_CHANGED");
      await io.stageImage(source,target.storagePath,item.sha256);
      await io.assertAccount();
      mediaVerified++;
    }
    // If another device created the same ID while this device uploaded
    // images, compare content first instead of issuing a blind overwrite.
    const current=await io.list();
    await io.assertAccount();
    const found=current.find(row=>row.record.id===record.id);
    if(found){
      if(!recordContentEqual(found.record,record,true)){
        throw Error("V3_MIRROR_CONCURRENT_CONFLICT");
      }
      alreadyPresent++;
      continue;
    }
    let result:CloudRecordEnvelope;
    try{
      result=await io.create(record);
    }catch(error){
      // The CAS may have lost a concurrent insert. Accept ONLY identical
      // contents; any other failure is propagated without claiming success.
      const changed=await io.list();
      await io.assertAccount();
      const winner=changed.find(row=>row.record.id===record.id);
      if(!winner||!recordContentEqual(winner.record,record,true))throw error;
      alreadyPresent++;
      continue;
    }
    await io.assertAccount();
    if(result.record.id!==record.id ||
       !recordContentEqual(result.record,record,true) ||
       !/^[1-9]\d*$/.test(result.serverRevision)) {
      throw Error("V3_MIRROR_SERVER_ACK_INVALID");
    }
    created++;
  }
  await io.assertAccount();
  // No live-mode promotion, account writer activation or V2 data mutation.
  return {total:plan.records,mediaVerified,created,alreadyPresent};
}