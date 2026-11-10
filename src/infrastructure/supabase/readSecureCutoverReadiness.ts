import { getAccountClient } from "../../supabase";
import { currentStorageScope } from "../../storage";
import {
  classifySecureCutoverReadiness,
  type SecureCutoverReadiness,
} from "../../core/application/classifySecureCutoverReadiness";

/** Explicit, authenticated read-only preflight. No activation, CAS, uploads,
 * approval writes or account changes. Relies on server RLS, never on username
 * strings, local ownerKey paths or user-editable JWT metadata. */
export async function readSecureCutoverReadiness(): Promise<SecureCutoverReadiness> {
  const account=getAccountClient(),scope=currentStorageScope();
  const {data:initial,error:firstError}=await account.auth.getUser();
  const userId=initial.user?.id.toLowerCase();
  if(firstError||!userId||scope!==userId)throw Error("V3_CUTOVER_SIGNIN_REQUIRED");
  const assertUser=async()=>{
    if(currentStorageScope()!==scope)throw Error("V3_CUTOVER_ACCOUNT_CHANGED");
    const checked=await account.auth.getUser();
    if(checked.error||checked.data.user?.id.toLowerCase()!==userId ||
       currentStorageScope()!==scope)throw Error("V3_CUTOVER_ACCOUNT_CHANGED");
  };
  await assertUser();
  const [status,approval,mode]=await Promise.all([
    account.rpc("live_memory_v3_secure_account_readiness",{}),
    account.from("live_memory_v3_cutover_approvals")
      .select("legacy_digest,mirror_digest,full_backup_verified,media_bytes_verified,personal_sources_verified")
      .eq("user_id",userId).limit(1),
    account.rpc("live_memory_v3_mode_account",{}),
  ]);
  await assertUser();
  if(status.error||approval.error||mode.error){
    throw Error("V3_CUTOVER_READINESS_SERVER_UNAVAILABLE");
  }
  const data=Array.isArray(status.data)?status.data.length===1?status.data[0]:null:status.data;
  if(!data||!Array.isArray(approval.data)||approval.data.length>1||
     (mode.data!=="v2"&&mode.data!=="v3")){
    throw Error("V3_CUTOVER_INVALID_SERVER_RESPONSE");
  }
  const result=classifySecureCutoverReadiness(
    data,approval.data[0]||null,mode.data,
  );
  await assertUser();
  return result;
}
