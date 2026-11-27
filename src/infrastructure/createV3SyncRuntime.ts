import type { AppSettings } from "../domain";
import { inspectLegacyV3Adoption } from "../core/application/inspectLegacyV3Adoption";
import { recordRevision, recordContentEqual } from "../core/sync/revision";
import { blankRecord } from "../seeds";
import { composeQiHubMemoryRecord, type QiHubMemoryCommand } from "./qihubNativeMemoryFields";
import { currentStorageScope } from "../storage";
import { getAccountClient, makeSupabaseClient } from "../supabase";
import { hasVerifiedOfflineMedia, persistVerifiedOfflineMedia, resolveMediaSource } from "../mediaCache";
import { SupabaseV3MediaTransport, V3_PRIVATE_MEDIA_BUCKET, type V3MediaStorageClient } from "./supabase/V3MediaTransport";
import { SupabaseV3AccountMediaTransport } from "./supabase/V3AuthenticatedMediaTransport";
import type { V3MediaTransport } from "./supabase/V3MediaTransport";
import { IndexedDbRecordRepository } from "./indexedDb/recordRepository";
import { IndexedDbRevisionLedger } from "./indexedDb/revisionLedger";
import { SupabaseV3RecordAdapter, type V3RpcClient } from "./supabase/V3CloudRecordAdapter";
import { auditSyncReadOnly, type ReadOnlySyncAudit } from "../core/application/auditSyncReadOnly";
import { reviewMigrationReadOnly, type MigrationReview } from "../core/application/reviewMigrationReadOnly";
import { synchronizeWithLedger } from "../core/application/synchronizeWithLedger";
import { bootstrapEquivalentBaselines, type BaselineBootstrapReport } from "../core/application/bootstrapEquivalentBaselines";
import type { SyncRunResult } from "../core/application/synchronizeRecords";
import type { CloudRecordEnvelope } from "../core/ports/CloudRecordAdapter";

/**
 * A real, authenticated V3 runtime, but still OPT-IN and not imported by V2.
 * Its preflight is read-only. The caller must explicitly disable V2 auto-sync
 * before enabling V3 writes; two unrelated sync engines must not run together.
 */
export class V3SyncRuntime {
  constructor(
    private readonly local: IndexedDbRecordRepository,
    private readonly remote: SupabaseV3RecordAdapter,
    private readonly ledger: IndexedDbRevisionLedger,
  ) {}

  /** Authenticated read-only gate. No V3 editing is permitted while the
   * account is still owned by the legacy V2 writer. */
  async writerMode(): Promise<"v2" | "v3"> {
    return this.remote.writerMode();
  }

  async audit(): Promise<ReadOnlySyncAudit> {
    const baseline = await this.ledger.snapshot();
    return auditSyncReadOnly(this.local, this.remote, {
      read: (id) => baseline.get(id),
    });
  }

  /** Shows only private, in-browser conflict metadata. Never writes any record. */
  async review(): Promise<MigrationReview> {
    const baseline = await this.ledger.snapshot();
    return reviewMigrationReadOnly(this.local, this.remote, {
      read: (id) => baseline.get(id),
    });
  }

  /** Full personal cloud inventory for an explicit, user-downloaded
   * migration backup. Read-only even while the server is still in V2 mode.
   * Account text backups cannot stand in for recoverable private images. */
  async readPersonalCloudForPortableBackup(): Promise<CloudRecordEnvelope[]> {
    if (this.remote.provider !== "personal" || !this.remote.includeMedia) {
      throw new Error("V3_COMPLETE_BACKUP_REQUIRES_PERSONAL_CLOUD");
    }
    return this.remote.list();
  }

  /** QiHub Android metadata-only read of the exact authenticated V3 account.
   * Preserves server CAS revisions and private Storage *references* without
   * copying any media bytes or revealing the Supabase session credential. */
  async readAuthenticatedV3ManifestForQiHub(): Promise<CloudRecordEnvelope[]> {
    if (this.remote.provider !== "secure-account" ||
        await this.remote.writerMode() !== "v3") {
      throw new Error("QIHUB_V3_AUTHENTICATED_CUTOVER_REQUIRED");
    }
    return this.remote.listMetadataOnly();
  }

  async readAuthenticatedV3OriginalForQiHub(
    recordId: string, assetId: string, revision: number,
  ): Promise<Blob> {
    if(this.remote.provider!=="secure-account" ||
       await this.remote.writerMode()!=="v3"){
      throw Error("QIHUB_V3_AUTHENTICATED_CUTOVER_REQUIRED");
    }
    const rows=await this.remote.listMetadataOnly();
    const row=rows.find(item=>item.record.id===recordId);
    if(!row||Number(row.serverRevision)!==revision){
      throw Error("QIHUB_V3_MEDIA_RECORD_REVISION_CHANGED");
    }
    const asset=row.record.media.find(item=>item.id===assetId);
    if(!asset||asset.recordId!==recordId||!asset.storagePath){
      throw Error("QIHUB_V3_ORIGINAL_REFERENCE_MISSING");
    }
    return this.remote.readVerifiedOriginalForQiHub(asset);
  }

  /** Explicit QiHub native event editor. The authenticated source app owns
   * the cloud CAS, local archive and acknowledged synchronization baseline.
   * Editing a cloud row with unsynced local changes is refused before RPC.
   */
  async mutateQiHubMemory(command: QiHubMemoryCommand) {
    if (this.remote.provider !== "secure-account" ||
        await this.remote.writerMode() !== "v3") {
      throw Error("QIHUB_MEMORY_V3_WRITER_NOT_ACTIVE");
    }
    if (!["create", "update", "trash", "restore"].includes(command.operation)) {
      throw Error("QIHUB_MEMORY_INVALID_OPERATION");
    }
    const originalRemote = await this.remote.listMetadataOnly();
    const beforeLocal = await this.local.list();
    const previous = command.id
      ? originalRemote.find(item => item.record.id === command.id)
      : undefined;
    const isCreate = command.operation === "create";
    if (isCreate ? Boolean(command.id || command.expectedRevision !== undefined) :
        (!previous || !Number.isSafeInteger(command.expectedRevision) ||
         command.expectedRevision !== Number(previous.serverRevision))) {
      throw Error("QIHUB_MEMORY_REVISION_CHANGED");
    }
    if (!isCreate && previous) {
      const localRecord=beforeLocal.find(item => item.id === previous.record.id);
      // Editing must not overwrite an unsynced edit kept in the original
      // browser. A freshly signed-in origin should recover first.
      if (!localRecord || !recordContentEqual(localRecord, previous.record, true)) {
        throw Error("QIHUB_MEMORY_LOCAL_CLOUD_DIVERGED");
      }
    }
    const now = new Date().toISOString();
    let next = isCreate
      ? blankRecord() : {...previous!.record};
    if (isCreate || command.operation === "update") {
      next = composeQiHubMemoryRecord(next, command.fields ?? {});
    }
    if (command.operation === "trash") {
      if (next.deletedAt) throw Error("QIHUB_MEMORY_ALREADY_TRASHED");
      next = {...next, deletedAt:now};
    } else if (command.operation === "restore") {
      if (!next.deletedAt) throw Error("QIHUB_MEMORY_NOT_TRASHED");
      const {deletedAt: _deletedAt, ...restored}=next;
      next=restored;
    }
    next={...next,updatedAt:now};
    const committed=await this.remote.compareAndSwapQiHubMetadata(next,previous ?? null);
    // The source local media URLs/cache remain untouched; the CAS returned
    // the same immutable private media references.
    const localBefore=beforeLocal.find(item=>item.id===committed.record.id);
    const localRecord={...committed.record,
      media:localBefore?.media ?? committed.record.media};
    let localUpdated=false;
    try {
      const applied=await this.local.applyRemoteIfUnchanged(
        beforeLocal,[localRecord],{includeMedia:true},
      );
      localUpdated=applied.acceptedIds.includes(committed.record.id);
      if (localUpdated) {
        const ledgerBefore=await this.ledger.snapshot();
        await this.ledger.commitIfUnchanged(ledgerBefore,[{
          id:committed.record.id,
          revision:await recordRevision(committed.record,true),
        }]);
      }
    } catch {
      // The cloud row already committed. A local persistence problem must
      // never turn a successful cloud write into an ambiguous "failed" ACK.
      localUpdated=false;
    }
    return {committed,localUpdated};
  }

  /** Metadata-only V2 adoption: never transfers, edits or removes an archive. */
  async bootstrapMatchingHistory(): Promise<BaselineBootstrapReport> {
    return bootstrapEquivalentBaselines(this.local, this.remote, this.ledger);
  }

  /**
   * A signed-in, already-activated V3 account may automatically re-home the
   * SAME V2 browser's old image paths. No user export, no cloud write.
   * Any divergent local edit, missing media or concurrent mutation aborts.
   */
  async adoptMatchingLegacyBrowserHistory():Promise<number>{
    if(this.remote.provider!=="secure-account" ||
       await this.remote.writerMode()!=="v3"){
      throw Error("V3_ADOPTION_AUTHENTICATED_CUTOVER_REQUIRED");
    }
    // Once this browser has acknowledged V3 revisions, ordinary additions
    // and edits belong to the revision ledger, not the one-time V2 migration.
    // Repeating the strict legacy inventory comparison on every refresh
    // creates false migration failures for normal V3 changes.
    if((await this.ledger.snapshot()).size>0){
      await this.bootstrapMatchingHistory();
      return 0;
    }
    const local=await this.local.list();
    if(!local.length)return 0; // A completely fresh browser uses first-device pull.
    const first=await this.remote.list();
    const initial=inspectLegacyV3Adoption(local,first.map(item=>item.record));
    if(!initial.changed){
      await this.bootstrapMatchingHistory();
      return 0;
    }
    // Every first-party original must be successfully fetched to the offline
    // media cache BEFORE updating a single local record reference.
    for(const item of first)await this.remote.prepareIncoming(item.record);
    const second=await this.remote.list();
    if(first.length!==second.length)throw Error("V3_ADOPTION_CLOUD_CHANGED");
    for(let i=0;i<first.length;i++){
      const a=first[i],b=second[i];
      if(a.record.id!==b.record.id || a.serverRevision!==b.serverRevision ||
         await recordRevision(a.record,true)!==await recordRevision(b.record,true)){
        throw Error("V3_ADOPTION_CLOUD_CHANGED");
      }
    }
    inspectLegacyV3Adoption(local,second.map(item=>item.record));
    const adopted=await this.local.adoptVerifiedCloudTransport(local,second.map(item=>item.record));
    await this.bootstrapMatchingHistory();
    return adopted.changed;
  }

  async synchronize(options: {
    /** Required: the existing V2 timer/handlers were disabled by the caller. */
    v2AutoSyncDisabled: true;
    /** Explicit opt-in only for first-time one-sided records. */
    initialTransferApproved?: boolean;
    /** Only established secure accounts may automatically receive new cloud rows. */
    ongoingAutoSync?: true;
  }): Promise<SyncRunResult> {
    if (options?.v2AutoSyncDisabled !== true) {
      throw new Error("V3 sync cannot run concurrently with the V2 automatic sync engine");
    }
    // The server, not the caller, decides whether V2 clients are fenced.
    if (await this.remote.writerMode() !== "v3") {
      throw new Error("V3_SERVER_CUTOVER_NOT_ACTIVE: Existing V2 clients may still overwrite cloud records");
    }
    const review = await this.audit();
    if (review.requiresMigrationReview) {
      throw new Error("V3_SYNC_MIGRATION_REVIEW_REQUIRED: Existing local and remote versions differ");
    }
    const oneSided = review.actions["pull-new"] + review.actions["push-new"];
    const establishedPull = options.ongoingAutoSync === true &&
      this.remote.provider === "secure-account" &&
      review.actions["push-new"] === 0 &&
      (await this.ledger.snapshot()).size > 0;
    if (oneSided > 0 && !options.initialTransferApproved) {
      if (!establishedPull) throw new Error("V3_INITIAL_TRANSFER_APPROVAL_REQUIRED: Confirm old records before first transfer");
    }
    return synchronizeWithLedger(this.local, this.remote, this.ledger, {
      newRecordPolicy: options.initialTransferApproved ? "both" : establishedPull ? "pull-only" : "none",
    });
  }
}

export async function createV3SyncRuntime(
  settings: AppSettings,
  provider: "personal" | "account" | "secure-account",
): Promise<V3SyncRuntime> {
  const scope = currentStorageScope();
  if (!scope.trim()) throw new Error("An authenticated and scoped local archive is required");

  let client: V3RpcClient;
  let identity: string;
  let mediaTransport: V3MediaTransport | undefined;
  let assertIdentity: () => Promise<void>;
  if (provider === "account" || provider === "secure-account") {
    const account = getAccountClient();
    const { data, error } = await account.auth.getUser();
    if (error || !data.user?.id) throw new Error("Sign in before preparing V3 account synchronization");
    if (currentStorageScope() !== scope || scope !== data.user.id.toLowerCase()) {
      throw new Error("Authenticated user and active storage account do not match");
    }
    const openingUser = data.user.id.toLowerCase();
    identity = (import.meta.env.VITE_ACCOUNT_SUPABASE_URL || "").trim().toLowerCase() +
      "|user:" + openingUser + (provider === "secure-account" ? "|full-media" : "");
    client = account as unknown as V3RpcClient;
    assertIdentity = async () => {
      if (currentStorageScope() !== scope) throw new Error("V3_ACCOUNT_SESSION_CHANGED");
      const { data: checked, error: checkError } = await account.auth.getUser();
      if (checkError || checked.user?.id.toLowerCase() !== openingUser || currentStorageScope() !== scope) {
        throw new Error("V3_ACCOUNT_SESSION_CHANGED");
      }
    };
    if (provider === "secure-account") {
      // Unlike the historical text-only account backup, full-media V3 uses
      // account JWT Storage and CAS without any leaked personal ownerKey.
      mediaTransport = new SupabaseV3AccountMediaTransport(
        account as unknown as V3MediaStorageClient,
        openingUser,
        () => {
          if (currentStorageScope() !== scope) throw new Error("V3_ACCOUNT_SESSION_CHANGED");
        },
        (asset) => resolveMediaSource(asset,true),
        (asset,blob) => persistVerifiedOfflineMedia(asset,blob),
        (asset) => hasVerifiedOfflineMedia(asset),
      );
    }
  } else {
    const endpoint = settings.supabase.url.trim().replace(/\/+$/, "").toLowerCase();
    const owner = settings.supabase.ownerKey?.trim() || "";
    if (!/^https:\/\//.test(endpoint) || !/^[a-f0-9]{64}$/.test(owner)) {
      throw new Error("A configured secure personal cloud and owner key are required for V3");
    }
    const personal = makeSupabaseClient(settings);
    client = personal as unknown as V3RpcClient;
    identity = endpoint + "|owner:" + owner;
    assertIdentity = async () => {
      if (currentStorageScope() !== scope ||
          settings.supabase.ownerKey?.trim() !== owner ||
          settings.supabase.url.trim().replace(/\/+$/, "").toLowerCase() !== endpoint) {
        throw new Error("V3_PERSONAL_SCOPE_CHANGED");
      }
    };
    // V3 is always a full-media personal cloud. Never inherit the V2
    // mediaBucket setting: the legacy echo-media bucket is publicly readable.
    // This dedicated private bucket must pass security review before cutover.
    mediaTransport = new SupabaseV3MediaTransport(
      personal as unknown as V3MediaStorageClient,
      V3_PRIVATE_MEDIA_BUCKET,
      owner,
      () => {
        if (currentStorageScope() !== scope) {
          throw new Error("V3_MEDIA_ACCOUNT_CHANGED");
        }
      },
      (asset) => resolveMediaSource(asset, true),
      settings.supabase.mediaBucket, // legacy V2 SOURCE only; never a V3 upload target
      (asset, blob) => persistVerifiedOfflineMedia(asset, blob),
      (asset) => hasVerifiedOfflineMedia(asset),
    );
  }

  if (currentStorageScope() !== scope) throw new Error("Account switched during V3 runtime construction");
  const local = new IndexedDbRecordRepository(scope);
  const remote = new SupabaseV3RecordAdapter(client, provider, identity, scope, mediaTransport, assertIdentity);
  const ledger = await IndexedDbRevisionLedger.create(scope, provider, identity);
  return new V3SyncRuntime(local, remote, ledger);
}
