import {createClient} from "npm:@supabase/supabase-js@2.53.0";

// Historical Damai posters/seat maps must be recovered by the signed-in owner.
// No service-role key, user-supplied URL, public proxy, direct SQL write or
// overriding a saved original is permitted.
const BUCKET="echo-v3-media-staging";
const TABLE="live_memory_v3_secure_records";
const MAX_BYTES=12*1024*1024;
const MAX_ITEMS=3;
const ORIGIN="https://qi-i.github.io";
const CDN="img.alicdn.com";
type Asset={id:string;recordId:string;kind:string;src:string;storagePath?:string;
  mimeType?:string;size?:number;source?:string};
type Archive={id:string;payload:{id:string;media:Asset[];[key:string]:unknown};v3_revision:number};
function allowOrigin(origin:string|null){
  return origin===ORIGIN||/^http:\/\/(?:localhost|127[.]0[.]0[.]1):[0-9]{2,5}$/.test(origin||"");
}
function headers(origin:string|null){
  const cors=allowOrigin(origin)?{"Access-Control-Allow-Origin":origin!,"Vary":"Origin"}:{};
  return {...cors,"Access-Control-Allow-Headers":"authorization,apikey,x-client-info,content-type",
    "Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store",
    "Content-Type":"application/json; charset=utf-8"};
}
function reply(data:Record<string,unknown>,status:number,origin:string|null){
  return new Response(JSON.stringify(data),{status,headers:headers(origin)});
}
function exactCdn(src:string){
  if(!src||src.length>4096)return false;
  try{const u=new URL(src);return u.protocol==="https:"&&u.hostname===CDN&&
    !u.username&&!u.password&&u.port===""&&
    /^https:\/\/img[.]alicdn[.]com\/[^\s<>"']+$/.test(src);
  }catch{return false;}
}
function candidate(a:Asset,id:string){
  return a.recordId===id&&Boolean(a.id)&&
    (a.kind==="poster"||a.kind==="seatMap")&&
    !a.storagePath&&exactCdn(a.src);
}
async function digest(bytes:Uint8Array){
  const exact=new Uint8Array(bytes.byteLength);exact.set(bytes);
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",exact.buffer));
  return [...hash].map(c=>c.toString(16).padStart(2,"0")).join("");
}
function identify(bytes:Uint8Array){
  if(bytes.length<20)return null;
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)
    return {mime:"image/jpeg",ext:"jpg"};
  if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))
    return {mime:"image/png",ext:"png"};
  const text=(a:number,b:number)=>String.fromCharCode(...bytes.subarray(a,b));
  if(text(0,4)==="RIFF"&&text(8,12)==="WEBP")
    return {mime:"image/webp",ext:"webp"};
  if(text(0,6)==="GIF87a"||text(0,6)==="GIF89a")
    return {mime:"image/gif",ext:"gif"};
  if(text(4,8)==="ftyp"&&["avif","avis"].includes(text(8,12)))
    return {mime:"image/avif",ext:"avif"};
  return null;
}
async function downloadOriginal(src:string){
  if(!exactCdn(src))throw Error("UNTRUSTED_SOURCE");
  const ac=new AbortController();
  const timeout=setTimeout(()=>ac.abort(),13000);
  try{
    const response=await fetch(src,{redirect:"manual",signal:ac.signal,
      headers:{"Accept":"image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
        "Referer":"https://m.damai.cn/",
        "User-Agent":"Mozilla/5.0 (compatible; LiveMemoryOriginalArchiver/1.0)"}});
    if(!response.ok||response.status>=300||response.type==="opaqueredirect"){
      const category=response.status===403?"CDN_FORBIDDEN":
        response.status===404?"CDN_NOT_FOUND":
        response.status===429?"CDN_RATE_LIMITED":
        response.status>=500?"CDN_SERVER_ERROR":"CDN_DOWNLOAD_UNAVAILABLE";
      throw Error(category);
    }
    const knownSize=Number(response.headers.get("content-length")||"0");
    if(knownSize>MAX_BYTES)throw Error("CDN_IMAGE_TOO_LARGE");
    if(!response.body)throw Error("CDN_MISSING_BODY");
    const parts:Uint8Array[]=[];let count=0;
    for await(const chunk of response.body){
      count+=chunk.byteLength;
      if(count>MAX_BYTES){await response.body.cancel().catch(()=>{});throw Error("CDN_IMAGE_TOO_LARGE");}
      parts.push(chunk);
    }
    if(count<20)throw Error("CDN_EMPTY_OR_INVALID_IMAGE");
    const bytes=new Uint8Array(count);let offset=0;
    for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    const detected=identify(bytes);
    if(!detected)throw Error("CDN_NOT_A_SUPPORTED_IMAGE");
    return {bytes,...detected};
  }catch(error){
    if(error instanceof Error&&error.name==="AbortError")throw Error("CDN_TIMEOUT");
    throw error;
  }finally{clearTimeout(timeout);}
}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response("",{
    status:204,headers:headers(origin)});
  if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405,origin);
  if(origin&&!allowOrigin(origin))return reply({error:"ORIGIN_NOT_ALLOWED"},403,origin);
  const auth=req.headers.get("authorization")||"";
  if(!/^Bearer [^\s]+$/i.test(auth))return reply({error:"SIGN_IN_REQUIRED"},401,origin);
  const url=Deno.env.get("SUPABASE_URL")||"";
  const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
  if(!url||!anon)return reply({error:"SERVER_NOT_CONFIGURED"},503,origin);
  const sb=createClient(url,anon,{
    global:{headers:{Authorization:auth}},
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  });
  const {data:who,error:userError}=await sb.auth.getUser();
  if(userError||!who.user?.id)return reply({error:"SIGN_IN_REQUIRED"},401,origin);
  const uid=who.user.id.toLowerCase();
  const {data:mode,error:modeError}=await sb.rpc("live_memory_v3_mode_account",{});
  if(modeError||mode!=="v3")return reply({error:"V3_CUTOVER_NOT_ACTIVE"},409,origin);
  let limit=2;
  let offset=0;
  try{
    const value=await req.json();
    if(value && typeof value==="object" && value.limit!==undefined)
      limit=Math.max(1,Math.min(MAX_ITEMS,Number(value.limit)||1));
    if(value && typeof value==="object" && value.offset!==undefined){
      const parsed=Number(value.offset);
      if(!Number.isSafeInteger(parsed)||parsed<0||parsed>500)
        return reply({error:"INVALID_OFFSET"},400,origin);
      offset=parsed;
    }
  }catch{return reply({error:"INVALID_REQUEST"},400,origin);}
  const {data:rows,error:rowsError}=await sb.from(TABLE)
    .select("id,payload,v3_revision").eq("user_id",uid)
    .order("id",{ascending:true}).limit(500);
  if(rowsError||!Array.isArray(rows))return reply({error:"V3_READ_UNAVAILABLE"},503,origin);
  const pending=(rows as Archive[]).flatMap(row=>
    Array.isArray(row.payload?.media)?row.payload.media.filter(a=>candidate(a,row.id))
      .map(a=>({row,asset:a})):[]);
  if(!pending.length||offset>=pending.length)return reply({remaining:pending.length,recovered:0,failed:0,attempted:0,nextOffset:0},200,origin);
  let recovered=0,failed=0;
  const failureReasons:Record<string,number>={};
  for(const {row,asset} of pending.slice(offset,offset+limit)){
    try{
      const original=await downloadOriginal(asset.src);
      const hash=await digest(original.bytes);
      const path=uid+"/v3/"+await digest(new TextEncoder().encode(row.id))+
        "/"+await digest(new TextEncoder().encode(asset.id))+
        "/"+hash+"."+original.ext;
      const store=sb.storage.from(BUCKET);
      const upload=await store.upload(path,new Blob([original.bytes],{type:original.mime}),
        {upsert:false,contentType:original.mime,cacheControl:"31536000"});
      if(upload.error&&!(/already exists|duplicate/i.test(upload.error.message||"")||
          String(upload.error.statusCode)==="409"))throw Error("PRIVATE_UPLOAD_FAILED");
      // A 409 is never proof of preservation: verify the actual byte hash.
      const {data:copy,error:copyError}=await store.download(path);
      if(copyError||!copy||copy.size!==original.bytes.byteLength||
        await digest(new Uint8Array(await copy.arrayBuffer()))!==hash)
        throw Error("PRIVATE_IMAGE_HASH_MISMATCH");
      const media=row.payload.media.map(item=>item.id===asset.id ? {
        ...item,src:"",storagePath:path,source:"supabase",
        mimeType:original.mime,size:original.bytes.byteLength,
      }:item);
      const next={...row.payload,media};
      // Authenticated optimistic CAS prevents changing edited/other users' rows.
      const {data:committed,error:casError}=await sb.rpc("live_memory_v3_cas_secure_account",{
        p_id:row.id,p_payload:next,p_expected_revision:row.v3_revision,
        p_expected_user:uid,
      });
      if(casError||!committed|| (Array.isArray(committed)&&committed.length!==1))
        throw Error("V3_REVISION_CONFLICT_OR_CAS_FAILED");
      row.v3_revision+=1;
      row.payload=next;
      recovered++;
    }catch(error){
      // Only a bounded, fixed set of diagnostic *categories* is returned,
      // never URLs, JWTs, concert titles, file names or raw exception text.
      const code=error instanceof Error?error.message:"UNKNOWN_FAILURE";
      const allowed=new Set([
        "CDN_FORBIDDEN","CDN_NOT_FOUND","CDN_RATE_LIMITED",
        "CDN_SERVER_ERROR","CDN_DOWNLOAD_UNAVAILABLE","CDN_TIMEOUT",
        "CDN_IMAGE_TOO_LARGE","CDN_EMPTY_OR_INVALID_IMAGE",
        "CDN_NOT_A_SUPPORTED_IMAGE","CDN_MISSING_BODY","UNTRUSTED_SOURCE",
        "PRIVATE_UPLOAD_FAILED","PRIVATE_IMAGE_HASH_MISMATCH",
        "V3_REVISION_CONFLICT_OR_CAS_FAILED",
      ]);
      const reason=allowed.has(code)?code:"UNKNOWN_FAILURE";
      failureReasons[reason]=(failureReasons[reason]||0)+1;
      failed++;
    }
  }
  return reply({remaining:pending.length-recovered,recovered,failed,
    attempted:Math.min(limit,pending.length-offset),
    nextOffset:offset+failed,failureReasons},200,origin);
});
