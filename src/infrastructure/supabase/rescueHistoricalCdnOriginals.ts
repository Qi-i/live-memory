import {getAccountClient} from "../../supabase";
import {currentStorageScope} from "../../storage";

export interface HistoricalMediaRescueReport {
  attempted:number;
  recovered:number;
  failed:number;
  remaining:number;
  failureReasons:Record<string,number>;
}

/** Invokes a JWT-scoped, non-public CDN original archiver. No service keys
 * exist in browser code. Missing remote originals remain untouched and are
 * visibly reported as external URLs, never counted as backed up. */
export async function rescueHistoricalCdnOriginals(
  expectedScope:string,
  assertActive:()=>boolean,
):Promise<HistoricalMediaRescueReport>{
  if(!expectedScope||currentStorageScope()!==expectedScope||!assertActive())
    throw Error("V3_RESCUE_ACCOUNT_CHANGED");
  const client=getAccountClient();
  const identity=await client.auth.getUser();
  if(identity.error||identity.data.user?.id.toLowerCase()!==expectedScope)
    throw Error("V3_RESCUE_NOT_AUTHENTICATED");
  const counts:HistoricalMediaRescueReport={
    attempted:0,recovered:0,failed:0,remaining:0,failureReasons:{},
  };
  let offset=0;
  // At most 15 pages, each with two bounded CDN fetches: no unbounded API
  // loops when the image host is offline or a record becomes conflicted.
  for(let page=0;page<15;page++){
    if(!assertActive()||currentStorageScope()!==expectedScope)
      throw Error("V3_RESCUE_ACCOUNT_CHANGED");
    const {data,error}=await client.functions.invoke("v3-cdn-original-rescue",{
      body:{offset,limit:2},
    });
    if(!assertActive()||currentStorageScope()!==expectedScope)
      throw Error("V3_RESCUE_ACCOUNT_CHANGED");
    if(error||!data||typeof data!=="object")throw Error("V3_RESCUE_SERVICE_UNAVAILABLE");
    const row=data as Record<string,unknown>;
    const numbers=["attempted","recovered","failed","remaining","nextOffset"] as const;
    if(numbers.some(key=>!Number.isSafeInteger(row[key])||Number(row[key])<0||
       Number(row[key])>500)){
      throw Error("V3_RESCUE_BAD_SERVER_RESULT");
    }
    const tried=Number(row.attempted),success=Number(row.recovered);
    const failed=Number(row.failed);
    const remaining=Number(row.remaining),nextOffset=Number(row.nextOffset);
    if(tried>2||success+failed!==tried||success>remaining+success)
      throw Error("V3_RESCUE_BAD_SERVER_RESULT");
    const knownReasons=[
      "CDN_FORBIDDEN","CDN_NOT_FOUND","CDN_RATE_LIMITED",
      "CDN_SERVER_ERROR","CDN_DOWNLOAD_UNAVAILABLE","CDN_TIMEOUT",
      "CDN_IMAGE_TOO_LARGE","CDN_EMPTY_OR_INVALID_IMAGE",
      "CDN_NOT_A_SUPPORTED_IMAGE","CDN_MISSING_BODY","UNTRUSTED_SOURCE",
      "PRIVATE_UPLOAD_FAILED","PRIVATE_IMAGE_HASH_MISMATCH",
      "V3_REVISION_CONFLICT_OR_CAS_FAILED","UNKNOWN_FAILURE",
    ];
    const reasons=row.failureReasons;
    if(reasons!==undefined){
      if(!reasons||typeof reasons!=="object"||Array.isArray(reasons)||
        Object.entries(reasons).some(([key,value])=>
          !knownReasons.includes(key)||!Number.isSafeInteger(value)||Number(value)<0||
          Number(value)>tried) ||
        Object.values(reasons).reduce<number>((sum,value)=>sum+Number(value),0)!==failed){
        throw Error("V3_RESCUE_BAD_SERVER_FAILURE_REPORT");
      }
      for(const [key,value] of Object.entries(reasons)){
        counts.failureReasons[key]=(counts.failureReasons[key]||0)+Number(value);
      }
    }
    counts.attempted+=tried;counts.recovered+=success;
    counts.failed+=failed;counts.remaining=remaining;
    if(!tried||!remaining||nextOffset>=remaining)break;
    offset=nextOffset;
  }
  return counts;
}
