import { createV3SyncRuntime } from "./createV3SyncRuntime";
import { currentStorageScope, readSettings } from "../storage";

/** Existing signed-in V3 account, double-verified by the original V3 adapter.
 * A QiHub host receives only records and CAS server revisions. The private
 * media objects themselves are not yet transferred, and no auth credential,
 * signed Storage URL, or local IndexedDB-only record leaves this origin.
 */
export async function collectQiHubReadOnlySnapshot() {
  const accountId = currentStorageScope();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(accountId)) {
    throw Error("QIHUB_SOURCE_SIGN_IN_REQUIRED");
  }
  const runtime = await createV3SyncRuntime(readSettings(), "secure-account");
  const rows = await runtime.readAuthenticatedV3ManifestForQiHub();
  if (currentStorageScope() !== accountId) {
    throw Error("QIHUB_V3_ACCOUNT_CHANGED");
  }
  const events = rows.map(({ record, serverRevision }) => ({
    id: record.id,
    serverRevision: Number(serverRevision),
    record: {
      ...record,
      // Raw cloud metadata contains paths and historical external links.
      // Never send a generated/private signed URL or original image bytes.
      media: record.media.map(asset => ({ ...asset, src: "" })),
    },
  }));
  return {
    format: "qihub-native-source-snapshot-v1" as const,
    project: "memory" as const,
    accountId,
    source: "supabase-v3-secure-account" as const,
    capturedAt: new Date().toISOString(),
    complete: true as const,
    collections: { events },
  };
}

/** Real original-byte candidates only, from the currently authenticated V3
 * manifest. Legacy external CDNs have no private Storage bytes and must not
 * be reported as downloaded. */
export async function listQiHubOriginalMediaCandidates() {
  const snapshot=await collectQiHubReadOnlySnapshot();
  const items: Array<{
    recordId:string;assetId:string;serverRevision:number;
    storagePath:string;size:number|null;mime:string;
  }>=[];
  for(const row of snapshot.collections.events){
    for(const asset of row.record.media){
      if(!asset.storagePath)continue;
      items.push({
        recordId:row.id,assetId:asset.id,
        serverRevision:row.serverRevision,
        storagePath:asset.storagePath,
        size:typeof asset.size==="number"?asset.size:null,
        mime:asset.mimeType||"",
      });
    }
  }
  return {accountId:snapshot.accountId,items};
}

/** Download happens ONLY after QiHub explicitly starts an original-byte
 * transfer. The real V3 server revision and record/asset association are
 * freshly verified before private Supabase storage is queried.
 */
export async function readQiHubVerifiedOriginalMedia(
  recordId:string,assetId:string,serverRevision:number,
):Promise<Blob>{
  const accountId=currentStorageScope();
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(accountId)){
    throw Error("QIHUB_SOURCE_SIGN_IN_REQUIRED");
  }
  const runtime=await createV3SyncRuntime(readSettings(),"secure-account");
  const blob=await runtime.readAuthenticatedV3OriginalForQiHub(
    recordId,assetId,serverRevision);
  if(currentStorageScope()!==accountId){
    throw Error("QIHUB_V3_ACCOUNT_CHANGED");
  }
  return blob;
}
