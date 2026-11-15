import type { AppSettings } from "../domain";
import { inspectLegacyV3Adoption } from "../core/application/inspectLegacyV3Adoption";
import { recordRevision } from "../core/sync/revision";
import { decideRecordSync } from "../core/sync/policy";
import { protectConflictVersion } from "./indexedDb/v3ConflictVault";
import { recordContentEqual } from "../core/sync/revision";
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

export interface V3ConflictPreview {
  id: string;
  title: string;
  action: "conflict" | "unbased-divergence";
  localDigest: string;
  cloudDigest: string;
  cloudServerRevision: string;
  baselineDigest: string | null;
}

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

  /** This provider- and account-scoped acknowledgement proves this is not
   * the first archive transfer, while keeping all V3 write guards intact. */
  async hasAcknowledgedBaseline(): Promise<boolean> {
    return (await this.ledger.snapshot()).size > 0;
  }

  /** Shows only private, in-browser conflict metadata. Never writes any record. */
  async review(): Promise<MigrationReview> {
    const baseline = await this.ledger.snapshot();
    return reviewMigrationReadOnly(this.local, this.remote, {
      read: (id) => baseline.get(id),
    });
  }

  /** Read the actual two competing versions and the acknowledged digest.
   * A preview is a short-lived CAS token, never permission to overwrite
   * whatever the other device has subsequently written.
   */
  async previewConflict(id: string): Promise<V3ConflictPreview> {
    if (!id.trim()) throw Error("V3_CONFLICT_INVALID_ID");
    const [locals, remote, baseline] = await Promise.all([
      this.local.list(), this.remote.list(), this.ledger.snapshot(),
    ]);
    const local = locals.find(row => row.id === id);
    const cloud = remote.find(row => row.record.id === id);
    if (!local || !cloud) throw Error("V3_CONFLICT_TWO_VERSIONS_REQUIRED");
    const localDigest = await recordRevision(local, true);
    const cloudDigest = await recordRevision(cloud.record, true);
    const base = baseline.get(id);
    const action = decideRecordSync({
      localRevision: localDigest, remoteRevision: cloudDigest,
      acknowledgedRevision: base,
    }).action;
    if (action !== "conflict" && action !== "unbased-divergence") {
      throw Error("V3_CONFLICT_NOT_CURRENT");
    }
    return { id, title: local.title || cloud.record.title, action,
      localDigest, cloudDigest, cloudServerRevision: cloud.serverRevision,
      baselineDigest: base ?? null };
  }

  /** Explicit manual selection. The losing version and ALL obtainable
   * original media bytes must be durably protected before replacing anything.
   * Every revision and the server writer fence is checked immediately again.
   * A concurrent cloud CAS failure leaves both original versions unchanged.
   */
  async resolveConflict(
    expected: V3ConflictPreview, choice: "keep-local" | "keep-cloud",
  ): Promise<{ protectedKey: string; deferred: boolean }> {
    if (choice !== "keep-local" && choice !== "keep-cloud") {
      throw Error("V3_CONFLICT_CHOICE_REQUIRED");
    }
    if (await this.remote.writerMode() !== "v3") {
      throw Error("V3_SERVER_CUTOVER_NOT_ACTIVE");
    }
    const scope = this.local.scope;
    if (!scope || currentStorageScope() !== scope) throw Error("V3_CONFLICT_SCOPE_CHANGED");
    const [locals, remote, baseline] = await Promise.all([
      this.local.list(), this.remote.list(), this.ledger.snapshot(),
    ]);
    if (currentStorageScope() !== scope) throw Error("V3_CONFLICT_SCOPE_CHANGED");
    const local = locals.find(row => row.id === expected.id);
    const cloud = remote.find(row => row.record.id === expected.id);
    if (!local || !cloud) throw Error("V3_CONFLICT_VERSION_CHANGED");
    const [localDigest, cloudDigest] = await Promise.all([
      recordRevision(local, true), recordRevision(cloud.record, true),
    ]);
    if (localDigest !== expected.localDigest ||
      cloudDigest !== expected.cloudDigest ||
      cloud.serverRevision !== expected.cloudServerRevision ||
      (baseline.get(expected.id) ?? null) !== expected.baselineDigest ||
      recordContentEqual(local, cloud.record, true)) {
      throw Error("V3_CONFLICT_VERSION_CHANGED");
    }
    const decision = decideRecordSync({
      localRevision: localDigest, remoteRevision: cloudDigest,
      acknowledgedRevision: baseline.get(expected.id),
    }).action;
    if (decision !== expected.action || (
      decision !== "conflict" && decision !== "unbased-divergence"
    )) throw Error("V3_CONFLICT_VERSION_CHANGED");

    // Hydration ensures cloud originals exist in the verified offline cache.
    // Never replace an archive using only expiring private signed URLs.
    const durableCloud = this.remote.prepareIncoming
      ? await this.remote.prepareIncoming(cloud.record) : cloud.record;
    const losing = choice === "keep-local" ? durableCloud : local;
    const protectedKey = await protectConflictVersion(
      scope, losing, choice === "keep-local" ? "cloud" : "local",
      asset => resolveMediaSource(asset, true),
    );
    if (currentStorageScope() !== scope) throw Error("V3_CONFLICT_SCOPE_CHANGED");

    if (choice === "keep-cloud") {
      // The protected local original remains in the separate vault even if
      // a different tab wins the local CAS a moment before this commit.
      await this.local.saveIfUnchanged(durableCloud, local);
      const ack = await this.ledger.commitIfUnchanged(baseline, [
        { id: expected.id, revision: cloudDigest },
      ]);
      return { protectedKey, deferred: ack.deferredIds.length > 0 };
    }

    // One final local check before remote CAS; its expected cloud revision
    // still provides the server-side atomic guarantee for other devices.
    const current = (await this.local.list()).find(row => row.id === expected.id);
    if (!current || await recordRevision(current, true) !== localDigest) {
      throw Error("V3_CONFLICT_VERSION_CHANGED");
    }
    const accepted = await this.remote.compareAndSwap(local, cloud.serverRevision);
    const applied = await this.local.applyRemoteIfUnchanged(
      locals, [accepted.record], { includeMedia: true },
    );
    const acknowledged = await this.ledger.commitIfUnchanged(baseline, [
      { id: expected.id, revision: await recordRevision(accepted.record, true) },
    ]);
    return { protectedKey,
      deferred: applied.deferredIds.length > 0 || acknowledged.deferredIds.length > 0 };
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
    if (oneSided > 0 && !options.initialTransferApproved) {
      throw new Error("V3_INITIAL_TRANSFER_APPROVAL_REQUIRED: Confirm old records before first transfer");
    }
    return synchronizeWithLedger(this.local, this.remote, this.ledger);
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
