import type {EventRecord,MediaAsset} from "../../domain";
import type {V3MediaStorageClient,V3MediaTransport} from "./V3MediaTransport";

export const V3_ACCOUNT_MEDIA_BUCKET="echo-v3-media-staging";
const EXT:Record<string,string>={
  "image/jpeg":"jpg","image/png":"png","image/webp":"webp",
  "image/gif":"gif","image/avif":"avif",
};
const MAX=32*1024*1024;
const accountPattern=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
async function sha256(data:ArrayBuffer|Uint8Array|string):Promise<string>{
  const bytes=typeof data==="string"?new TextEncoder().encode(data):
    data instanceof Uint8Array?data:new Uint8Array(data);
  const exact=new Uint8Array(bytes.byteLength);
  exact.set(bytes);
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",exact.buffer as ArrayBuffer));
  return Array.from(digest,x=>x.toString(16).padStart(2,"0")).join("");
}
function sourceIsInline(src:string){return /^(?:data:|blob:)/i.test(src);}
function duplicate(error:{statusCode?:string|number;code?:string;name?:string;message:string}){
  return String(error.statusCode)==="409"||error.code==="AssetAlreadyExists"||
    error.name==="AssetAlreadyExists"||/already exists|duplicate/i.test(error.message);
}

/** Account-JWT-backed media transport: unlike personal V2, NO bearer ownerKey
 * appears in object paths or request headers. Every media object is private,
 * immutable and verified against the contents of its SHA-named path.
 */
export class SupabaseV3AccountMediaTransport implements V3MediaTransport {
  private readonly owner:string;
  constructor(
    private readonly client:V3MediaStorageClient,
    accountId:string,
    private readonly scopeCheck:()=>void,
    private readonly sourceResolver:(asset:MediaAsset)=>Promise<string>,
    private readonly cacheForOffline?:(asset:MediaAsset,blob:Blob)=>Promise<void>,
    private readonly hasOfflineCopy?:(asset:MediaAsset)=>Promise<boolean>,
  ){
    this.owner=accountId.toLowerCase();
    if(!accountPattern.test(this.owner))throw Error("V3_ACCOUNT_MEDIA_INVALID_OWNER");
  }
  assertScope(){this.scopeCheck();}
  private async verifyPath(asset:MediaAsset):Promise<string>{
    this.assertScope();
    if(!asset.storagePath||!asset.id||!asset.recordId)throw Error("V3_ACCOUNT_MEDIA_INVALID_PATH");
    const prefix=this.owner+"/v3/"+await sha256(asset.recordId)+"/"+await sha256(asset.id)+"/";
    this.assertScope();
    const tail=asset.storagePath.startsWith(prefix)?asset.storagePath.slice(prefix.length):"";
    const match=tail.match(/^([a-f0-9]{64})\.(jpg|png|webp|gif|avif)$/);
    if(!match||asset.storagePath.includes("..")||asset.storagePath.includes("?"))
      throw Error("V3_ACCOUNT_MEDIA_INVALID_PATH");
    return match[1];
  }
  async stage(recordId:string,asset:MediaAsset):Promise<MediaAsset>{
    this.assertScope();
    if(!recordId||!asset.id||asset.recordId!==recordId)
      throw Error("V3_ACCOUNT_MEDIA_RECORD_MISMATCH");

    // An existing complete, signed image can keep its immutable object ref.
    // Never treat old public V2 paths as account-private objects.
    if(asset.storagePath?.startsWith(this.owner+"/v3/")&&!sourceIsInline(asset.src)){
      await this.verifyPath(asset);
      if(asset.src)return asset;
      const signed=await this.client.storage.from(V3_ACCOUNT_MEDIA_BUCKET)
        .createSignedUrl(asset.storagePath,3600);
      this.assertScope();
      if(signed.error||!signed.data?.signedUrl)throw Error("V3_ACCOUNT_MEDIA_SIGNING_FAILED");
      return {...asset,src:signed.data.signedUrl,source:"supabase"};
    }

    const resolved=await this.sourceResolver(asset);
    this.assertScope();
    if(!resolved)throw Error("V3_ACCOUNT_MEDIA_BYTES_UNAVAILABLE");
    let blob:Blob;
    try{
      const response=await fetch(resolved,{credentials:"omit"});
      if(!response.ok||response.type==="opaque")
        throw Error("V3_ACCOUNT_MEDIA_BYTES_UNAVAILABLE");
      blob=await response.blob();
    }catch{throw Error("V3_ACCOUNT_MEDIA_BYTES_UNAVAILABLE");}
    this.assertScope();
    const mime=blob.type&&blob.type!=="application/octet-stream"
      ?blob.type.toLowerCase():(asset.mimeType||"").toLowerCase();
    if(!EXT[mime]||blob.size<1||blob.size>MAX)
      throw Error("V3_ACCOUNT_MEDIA_INVALID_BYTES");
    const bytes=await blob.arrayBuffer();
    const path=this.owner+"/v3/"+await sha256(recordId)+"/"+
      await sha256(asset.id)+"/"+await sha256(bytes)+"."+EXT[mime];
    this.assertScope();
    const remote=this.client.storage.from(V3_ACCOUNT_MEDIA_BUCKET);
    const upload=await remote.upload(path,new Blob([bytes],{type:mime}),{
      upsert:false,contentType:mime,cacheControl:"31536000",
    });
    this.assertScope();
    if(upload.error&&!duplicate(upload.error))throw Error("V3_ACCOUNT_MEDIA_UPLOAD_FAILED");
    const checked=await remote.download(path);
    this.assertScope();
    if(checked.error||!checked.data||checked.data.size!==blob.size||
       await sha256(await checked.data.arrayBuffer())!==await sha256(bytes)){
      throw Error("V3_ACCOUNT_MEDIA_CHECKSUM_MISMATCH");
    }
    const staged={...asset,src:resolved,storagePath:path,
      source:"supabase" as const,mimeType:mime,size:blob.size};
    if(this.cacheForOffline){
      await this.cacheForOffline(staged,new Blob([bytes],{type:mime}));
      this.assertScope();
    }
    return staged;
  }
  async hydrate(record:EventRecord):Promise<EventRecord>{
    this.assertScope();
    const media:MediaAsset[]=[];
    for(const asset of record.media||[]){
      await this.verifyPath(asset);
      this.assertScope();
      const response=await this.client.storage.from(V3_ACCOUNT_MEDIA_BUCKET)
        .createSignedUrl(asset.storagePath!,3600);
      this.assertScope();
      if(response.error||!response.data?.signedUrl)
        throw Error("V3_ACCOUNT_MEDIA_SIGNING_FAILED");
      media.push({...asset,src:response.data.signedUrl,source:"supabase"});
    }
    return {...record,media};
  }
  async ensureOffline(record:EventRecord):Promise<void>{
    this.assertScope();
    if(!this.cacheForOffline||!Array.isArray(record.media))
      throw Error("V3_ACCOUNT_MEDIA_CACHE_REQUIRED");
    for(const asset of record.media){
      const expected=await this.verifyPath(asset);
      this.assertScope();
      if(this.hasOfflineCopy&&await this.hasOfflineCopy(asset)){
        this.assertScope();continue;
      }
      const downloaded=await this.client.storage.from(V3_ACCOUNT_MEDIA_BUCKET)
        .download(asset.storagePath!);
      this.assertScope();
      if(downloaded.error||!downloaded.data||
         await sha256(await downloaded.data.arrayBuffer())!==expected){
        throw Error("V3_ACCOUNT_MEDIA_DOWNLOAD_FAILED");
      }
      await this.cacheForOffline(asset,downloaded.data);
      this.assertScope();
    }
  }
}
