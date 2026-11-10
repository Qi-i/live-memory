import type {EventRecord,AppSettings,MediaAsset} from "../../domain";
import type {CloudRecordEnvelope} from "../../core/ports/CloudRecordAdapter";
import type {PortableBackupDocument} from "../../core/application/portableMediaBackup";
import {
  planPrivateMirrorImport,
  type PrivateMirrorImportPlan,
} from "../../core/application/planPrivateMirrorImport";
import {
  importPortableBackupToSecureMirror,
  type PrivateMirrorImportResult,
  type PrivateMirrorImportIO,
} from "../../core/application/importPortableBackupToSecureMirror";
import {currentStorageScope} from "../../storage";
import {getAccountClient} from "../../supabase";
import {stableSerialize} from "../../core/sync/revision";

const TABLE="live_memory_v3_secure_records";
const BUCKET="echo-v3-media-staging";
const LIMIT=500;
const MAX=100_000;
async function sha256(blob: Blob):Promise<string>{
  const bytes=new Uint8Array(await blob.arrayBuffer());
  const copy=new Uint8Array(bytes.byteLength);copy.set(bytes);
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",copy.buffer as ArrayBuffer));
  return Array.from(hash,b=>b.toString(16).padStart(2,"0")).join("");
}
function parseCloudRow(value:unknown):CloudRecordEnvelope {
  if(!value||typeof value!=="object")throw Error("V3_MIRROR_BAD_REMOTE_ROW");
  const row=value as {id?:string;payload?:EventRecord;v3_revision?:number};
  if(!row.id||row.payload?.id!==row.id ||
     !Number.isSafeInteger(row.v3_revision)||Number(row.v3_revision)<1){
    throw Error("V3_MIRROR_BAD_REMOTE_ROW");
  }
  return {record:row.payload,serverRevision:String(row.v3_revision)};
}

async function prepareSession(){
  const account=getAccountClient();
  const scope=currentStorageScope();
  const initial=await account.auth.getUser();
  if(initial.error||!initial.data.user?.id)throw Error("V3_MIRROR_SIGNIN_REQUIRED");
  const userId=initial.data.user.id.toLowerCase();
  if(scope!==userId)throw Error("V3_MIRROR_ACCOUNT_SCOPE_MISMATCH");
  const assertAccount=async()=>{
    if(currentStorageScope()!==scope)throw Error("V3_MIRROR_ACCOUNT_CHANGED");
    const checked=await account.auth.getUser();
    if(checked.error||checked.data.user?.id.toLowerCase()!==userId ||
       currentStorageScope()!==scope)throw Error("V3_MIRROR_ACCOUNT_CHANGED");
  };
  const scan=async():Promise<CloudRecordEnvelope[]>=>{
    await assertAccount();
    const found:CloudRecordEnvelope[]=[];
    let previous="";
    for(let offset=0;offset<MAX;offset+=LIMIT){
      await assertAccount();
      const {data,error}=await account.from(TABLE)
        .select("id,payload,v3_revision")
        .order("id",{ascending:true})
        .range(offset,offset+LIMIT-1);
      await assertAccount();
      if(error||!Array.isArray(data))throw Error("V3_MIRROR_REMOTE_UNAVAILABLE");
      for(const item of data){
        const row=parseCloudRow(item);
        if(previous && row.record.id<=previous)throw Error("V3_MIRROR_INVALID_REMOTE_INVENTORY");
        previous=row.record.id;
        found.push(row);
      }
      if(data.length<LIMIT)return found;
    }
    throw Error("V3_MIRROR_TOO_MANY_RECORDS");
  };
  const list=async()=>{
    const first=await scan(),second=await scan();
    if(stableSerialize(first)!==stableSerialize(second))throw Error("V3_MIRROR_REMOTE_CHANGED");
    return second;
  };
  const io:PrivateMirrorImportIO={
    accountUserId:userId,assertAccount,list,
    async stageImage(asset:MediaAsset,expectedPath:string,expectedSha256:string){
      await assertAccount();
      if(!expectedPath.startsWith(userId+"/v3/") ||
         !/^[a-f0-9]{64}$/.test(expectedSha256) ||
         !/^data:image\/(?:jpeg|png|webp|gif|avif);base64,/i.test(asset.src)){
        throw Error("V3_MIRROR_INVALID_IMAGE");
      }
      let blob:Blob;
      try{
        const response=await fetch(asset.src,{credentials:"omit"});
        if(!response.ok)throw Error("Failed to decode");
        blob=await response.blob();
      }catch{throw Error("V3_MIRROR_IMAGE_DECODE_FAILED");}
      const mime=blob.type.toLowerCase();
      if(!blob.size||blob.size>32*1024*1024||
         !["image/jpeg","image/png","image/webp","image/gif","image/avif"].includes(mime)||
         await sha256(blob)!==expectedSha256){
        throw Error("V3_MIRROR_IMAGE_HASH_MISMATCH");
      }
      await assertAccount();
      const upload=await account.storage.from(BUCKET).upload(expectedPath,blob,{
        upsert:false,contentType:mime,cacheControl:"31536000",
      });
      await assertAccount();
      if(upload.error && String(upload.error.statusCode)!=="409" &&
         upload.error.name!=="AssetAlreadyExists" &&
         !/already exists|duplicate/i.test(upload.error.message||"")) {
        throw Error("V3_MIRROR_IMAGE_UPLOAD_FAILED");
      }
      // 409 is never trusted blindly: previous bytes must match.
      const {data,error}=await account.storage.from(BUCKET).download(expectedPath);
      await assertAccount();
      if(error||!data||data.size!==blob.size||await sha256(data)!==expectedSha256){
        throw Error("V3_MIRROR_STAGED_IMAGE_MISMATCH");
      }
      await assertAccount();
    },
    async create(record:EventRecord){
      await assertAccount();
      const {data,error}=await account.rpc("live_memory_v3_cas_secure_account",{
        p_id:record.id,
        p_payload:record,
        p_expected_revision:null,
        p_expected_user:userId,
      });
      await assertAccount();
      if(error)throw Error("V3_MIRROR_CAS_REJECTED");
      const row=Array.isArray(data)?data.length===1?data[0]:null:data;
      return parseCloudRow(row);
    },
  };
  return {userId,io};
}

export async function inspectSecureArchiveMirror(
  document:PortableBackupDocument,
):Promise<PrivateMirrorImportPlan>{
  const session=await prepareSession();
  const rows=await session.io.list();
  await session.io.assertAccount();
  return planPrivateMirrorImport(document,session.userId,rows);
}

/** Explicit mirror import only. Does not edit V2 rows, trigger a V3
 * writer-mode cutover, or switch any client away from production V2. */
export async function importSecureArchiveMirror(
  document:PortableBackupDocument,
):Promise<PrivateMirrorImportResult>{
  const session=await prepareSession();
  return importPortableBackupToSecureMirror(document,session.io);
}
