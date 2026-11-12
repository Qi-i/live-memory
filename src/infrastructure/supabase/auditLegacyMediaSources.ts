import type { AppSettings, EventRecord } from "../../domain";
import { currentStorageScope } from "../../storage";
import { deriveAccountLinkedLegacyOwnerKey, getAccountClient, makeSupabaseClient } from "../../supabase";
import type { CloudRecordEnvelope } from "../../core/ports/CloudRecordAdapter";
import { verifyBackupCloudUnchanged } from "../../core/application/completeBackupInventory";
import {
  auditLegacyMediaMigration,
  type LegacyMediaReference, type LegacyMediaMigrationManifest,
} from "../../core/application/auditLegacyMediaMigration";
import { createV3SyncRuntime } from "../createV3SyncRuntime";
import {
  verifyLegacyAccountProvenance,
  type LegacyProvenanceRow,
} from "../../core/application/verifyLegacyAccountProvenance";
import {
  stageLegacyMediaCopies,
  type LegacyMediaStagingResult,
} from "../../core/application/stageLegacyMediaCopies";

const PAGE = 100;
const MAX_OBJECTS = 2000;
const BUCKET = "echo-media";

type LinkedMediaRow = {
  id: string;
  record_id: string;
  storage_path: string | null;
  deleted_at: string | null;
};
function fingerprintRows(rows: readonly LinkedMediaRow[]): string {
  return JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)));
}
function fingerprintPaths(rows: readonly string[]): string {
  return JSON.stringify([...rows].sort());
}

/** No writes, no session creation, no owner switching. Every phase checks the
 * opening account + device storage scope; on logout the manifest is discarded.
 * This is only a PRE-MIGRATION audit: backend must independently verify the
 * authenticated account owner on any later rekey/copy operation. */
export type LegacyMediaTransferProgress =
  | { phase:"audit"; originalsVerified:number; originalTotal:number }
  | { phase:"copy"|"verify"; originalsVerified:number; originalTotal:number;
      copiesVerified:number; copyTotal:number };

interface VerifiedLegacyAuditContext {
  manifest: LegacyMediaMigrationManifest;
  /** Ephemeral private inputs; the downloaded report must not contain these. */
  objectNames: readonly string[];
  userId: string;
  personal: ReturnType<typeof makeSupabaseClient>;
  account: ReturnType<typeof getAccountClient>;
  assertScope(): void;
}
export async function auditAuthenticatedLegacyMedia(
  settings: AppSettings,
  onScopeCheck?: () => void,
  onVerified?: (context: VerifiedLegacyAuditContext) => Promise<void>,
  onProgress?: (progress:LegacyMediaTransferProgress)=>void,
): Promise<LegacyMediaMigrationManifest> {
  const ownerKey = settings.supabase.ownerKey?.trim().toLowerCase() || "";
  if (!/^[a-f0-9]{64}$/.test(ownerKey) || settings.supabase.mediaBucket !== BUCKET) {
    throw new Error("V3_LEGACY_MEDIA_INVALID_CONFIG");
  }
  const account = getAccountClient();
  const scope = currentStorageScope();
  const first = await account.auth.getUser();
  if (first.error || !first.data.user?.id) throw new Error("V3_LEGACY_AUTH_REQUIRED");
  const userId = first.data.user.id.toLowerCase();
  const verifyScope = () => {
    onScopeCheck?.();
    if (currentStorageScope() !== scope) throw new Error("V3_LEGACY_ACCOUNT_CHANGED");
  };
  verifyScope();
  const expectedOwnerKey = await deriveAccountLinkedLegacyOwnerKey(settings, userId);
  verifyScope();
  const personal = makeSupabaseClient(settings);

  // Old password-era keys are NOT necessarily derived from the authenticated
  // account UUID. The two credential types describe the same user's archive.
  // Never claim a key merely because it works: require the JWT-bound account
  // profile to link this exact personal project AND every original record to
  // match an existing account-owned backup (all non-media fields, tombstones).
  // This only permits a non-destructive private copy, never account rekey or
  // V3 writer cutover. No service-role client is used.
  let reverifyLegacyAccountProvenance: (() => Promise<void>) | null = null;
  if (expectedOwnerKey !== ownerKey) {
    const {data:profile,error:profileError}=await account
      .from("echo_user_profiles")
      .select("linked_supabase_url,linked_supabase_media_bucket")
      .eq("user_id",userId).single();
    verifyScope();
    const endpoint=(value:string)=>value.trim().replace(/\/+$/,"").toLowerCase();
    if (profileError || !profile ||
        endpoint(String(profile.linked_supabase_url||"")) !==
          endpoint(settings.supabase.url) ||
        profile.linked_supabase_media_bucket !== BUCKET) {
      throw Error("V3_LEGACY_OWNER_NOT_BOUND_TO_ACCOUNT");
    }
    const PAGE_SIZE=500;
    const readProvenance=async (
      provider:"personal"|"account",
    ):Promise<LegacyProvenanceRow[]>=>{
      const rows:LegacyProvenanceRow[]=[];
      const client=provider==="personal"?personal:account;
      const table=provider==="personal"?"echo_passkey_records":"echo_text_backups";
      for(let offset=0;offset<MAX_OBJECTS;offset+=PAGE_SIZE){
        verifyScope();
        let query=client.from(table)
          .select("id,payload,deleted_at").order("id",{ascending:true})
          .range(offset,offset+PAGE_SIZE-1);
        query=provider==="personal"
          ?query.eq("owner_key",ownerKey)
          :query.eq("user_id",userId);
        const {data,error}=await query;
        verifyScope();
        if(error || !data)throw Error("V3_LEGACY_PROVENANCE_READ_FAILED");
        rows.push(...data as LegacyProvenanceRow[]);
        if(data.length<PAGE_SIZE)return rows;
      }
      throw Error("V3_LEGACY_PROVENANCE_TOO_MANY_RECORDS");
    };
    const readAndVerify=async()=>{
      const [personalRows,accountRows]=await Promise.all([
        readProvenance("personal"),readProvenance("account"),
      ]);
      verifyScope();
      return verifyLegacyAccountProvenance(personalRows,accountRows);
    };
    const proof=await readAndVerify();
    verifyScope();
    reverifyLegacyAccountProvenance=async()=>{
      const fresh=await readAndVerify();
      verifyScope();
      if(proof.matchedRecords!==fresh.matchedRecords ||
         proof.sourceDigest!==fresh.sourceDigest)
        throw Error("V3_LEGACY_PROVENANCE_CHANGED");
    };
  }
  const runtime = await createV3SyncRuntime(settings, "personal");

  const loadRows = async (): Promise<LinkedMediaRow[]> => {
    const rows: LinkedMediaRow[] = [];
    for (let start=0; start<MAX_OBJECTS; start+=PAGE) {
      verifyScope();
      const { data, error } = await personal.from("echo_passkey_media_assets")
        .select("id,record_id,storage_path,deleted_at")
        .eq("owner_key", ownerKey)
        .order("id", { ascending:true })
        .range(start, start + PAGE - 1);
      verifyScope();
      if (error || !data) throw new Error("V3_LEGACY_MEDIA_INVENTORY_UNAVAILABLE");
      rows.push(...data as LinkedMediaRow[]);
      if (data.length < PAGE) break;
      if (start+PAGE >= MAX_OBJECTS) throw new Error("V3_LEGACY_MEDIA_TOO_MANY_OBJECTS");
    }
    return rows;
  };
  const listObjects = async (): Promise<string[]> => {
    const paths: string[] = [];
    const queued = [ownerKey];
    const visited = new Set<string>();
    while(queued.length) {
      verifyScope();
      const prefix=queued.shift()!;
      if(visited.has(prefix)||visited.size>MAX_OBJECTS) throw Error("V3_LEGACY_MEDIA_CYCLIC_PATH");
      visited.add(prefix);
      for(let offset=0;offset<MAX_OBJECTS;offset+=PAGE) {
        const {data,error} = await personal.storage.from(BUCKET).list(prefix,{
          limit:PAGE,offset,sortBy:{column:"name",order:"asc"},
        });
        verifyScope();
        if (error || !data) throw new Error("V3_LEGACY_MEDIA_STORAGE_LIST_FAILED");
        for (const entry of data) {
          if (!entry.name || entry.name==="." || entry.name===".." ||
              entry.name.includes("/")) throw new Error("V3_LEGACY_MEDIA_INVALID_FOLDER");
          const path = prefix + "/" + entry.name;
          if (entry.id === null || entry.id === undefined) {
            if(path.split("/").length > 12) throw Error("V3_LEGACY_MEDIA_FOLDER_TOO_DEEP");
            queued.push(path);
          } else {
            paths.push(path);
          }
          if(paths.length+queued.length>MAX_OBJECTS)throw Error("V3_LEGACY_MEDIA_TOO_MANY_OBJECTS");
        }
        if(data.length<PAGE) break;
        if(offset+PAGE>=MAX_OBJECTS)throw Error("V3_LEGACY_MEDIA_TOO_MANY_OBJECTS");
      }
    }
    return paths;
  };
  const [cloudBefore,linkedBefore,objectsBefore] = await Promise.all([
    runtime.readPersonalCloudForPortableBackup(),loadRows(),listObjects(),
  ]);
  verifyScope();
  const refs: LegacyMediaReference[] = linkedBefore.filter(row=>row.storage_path).map(row=>({
    id:row.id,recordId:row.record_id,storagePath:row.storage_path!,
  }));
  const records: EventRecord[] = cloudBefore.map((row:CloudRecordEnvelope)=>row.record);
  const audit = await auditLegacyMediaMigration({
    ownerKey, records,assetRows:refs,objectNames:objectsBefore,
    download:async(path)=>{
      verifyScope();
      const {data,error}=await personal.storage.from(BUCKET).download(path);
      verifyScope();
      if(error||!data)throw Error("V3_LEGACY_MEDIA_DOWNLOAD_FAILED");
      return data;
    },
    assertScope:verifyScope,
    onProgress:(processed,total)=>onProgress?.({
      phase:"audit",originalsVerified:processed,originalTotal:total,
    }),
  });
  verifyScope();

  // A multi-device V2 edit during the audit would invalidate the file-count
  // and path/hash proof. Re-read all inventories immediately before export.
  const [cloudAfter,linkedAfter,objectsAfter] = await Promise.all([
    runtime.readPersonalCloudForPortableBackup(),loadRows(),listObjects(),
  ]);
  verifyScope();
  verifyBackupCloudUnchanged(cloudBefore,cloudAfter);
  if(fingerprintRows(linkedBefore)!==fingerprintRows(linkedAfter) ||
     fingerprintPaths(objectsBefore)!==fingerprintPaths(objectsAfter)) {
    throw Error("V3_LEGACY_MEDIA_INVENTORY_CHANGED");
  }
  const finalUser = await account.auth.getUser();
  verifyScope();
  if(finalUser.error||finalUser.data.user?.id.toLowerCase()!==userId) {
    throw Error("V3_LEGACY_ACCOUNT_CHANGED");
  }
  await reverifyLegacyAccountProvenance?.();
  if (onVerified) {
    // Copies to an additional private, auth-bound staging bucket are allowed
    // ONLY after a complete two-pass, account-bound read-only audit. They do
    // not update V2 records, old images or the V3 writer marker.
    await onVerified({
      manifest:audit,objectNames:objectsAfter,userId,personal,account,
      assertScope:verifyScope,
    });
    verifyScope();
    const [cloudFinal,linkedFinal,objectsFinal]=await Promise.all([
      runtime.readPersonalCloudForPortableBackup(),loadRows(),listObjects(),
    ]);
    verifyScope();
    verifyBackupCloudUnchanged(cloudBefore,cloudFinal);
    if(fingerprintRows(linkedBefore)!==fingerprintRows(linkedFinal) ||
       fingerprintPaths(objectsBefore)!==fingerprintPaths(objectsFinal)) {
      throw Error("V3_LEGACY_MEDIA_INVENTORY_CHANGED");
    }
    const checkedUser=await account.auth.getUser();
    verifyScope();
    if(checkedUser.error || checkedUser.data.user?.id.toLowerCase()!==userId){
      throw Error("V3_LEGACY_ACCOUNT_CHANGED");
    }
    // Account provenance may change during 40 original downloads. A changed
    // source halts acceptance; immutable staged bytes remain safe to retry.
    await reverifyLegacyAccountProvenance?.();
  }
  return audit;
}

/** Explicit action: copy old images to a NEW private, per-auth-user bucket.
 * Every copy is byte-verified. V2 originals and writer markers are untouched.
 * This is preparatory staging, NOT a credential rotation or final cutover. */
export async function stageAuthenticatedLegacyMedia(
  settings: AppSettings,
  onScopeCheck?: () => void,
  onProgress?: (progress:LegacyMediaTransferProgress)=>void,
  verifyOnly = false,
): Promise<LegacyMediaStagingResult> {
  let result: LegacyMediaStagingResult | null = null;
  await auditAuthenticatedLegacyMedia(settings,onScopeCheck,async(ctx)=>{
    const staging="echo-v3-media-staging";
    result=await stageLegacyMediaCopies(ctx.manifest,{
      accountUserId:ctx.userId,
      sourcePaths:ctx.objectNames,
      assertScope:ctx.assertScope,
      verifyOnly,
      onProgress:counts=>onProgress?.({
        phase:verifyOnly?"verify":"copy",...counts,
      }),
      downloadOriginal:async(path)=>{
        ctx.assertScope();
        const {data,error}=await ctx.personal.storage.from(BUCKET).download(path);
        ctx.assertScope();
        if(error||!data)throw Error("V3_STAGING_SOURCE_DOWNLOAD_FAILED");
        return data;
      },
      uploadPrivate:async(path,blob,mimeType)=>{
        ctx.assertScope();
        const {error}=await ctx.account.storage.from(staging).upload(path,blob,{
          upsert:false,contentType:mimeType,cacheControl:"31536000",
        });
        ctx.assertScope();
        if(!error)return "uploaded";
        if(String(error.statusCode)==="409" ||
           error.name==="AssetAlreadyExists" ||
           /already exists|duplicate/i.test(error.message||""))return "exists";
        throw Error("V3_STAGING_PRIVATE_UPLOAD_FAILED");
      },
      downloadPrivate:async(path)=>{
        ctx.assertScope();
        const {data,error}=await ctx.account.storage.from(staging).download(path);
        ctx.assertScope();
        if(error||!data)throw Error("V3_STAGING_PRIVATE_DOWNLOAD_FAILED");
        return data;
      },
    });
  },onProgress);
  if(!result)throw Error("V3_STAGING_UNVERIFIED");
  return result;
}

/** Independent SHA readback, no uploads and no changes to old or V3 media. */
export async function verifyAuthenticatedStagedLegacyMedia(
  settings:AppSettings,
  onScopeCheck?:()=>void,
  onProgress?:(progress:LegacyMediaTransferProgress)=>void,
):Promise<LegacyMediaStagingResult> {
  return stageAuthenticatedLegacyMedia(settings,onScopeCheck,onProgress,true);
}
