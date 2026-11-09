import type { AppSettings } from "../domain";
import { currentStorageScope } from "../storage";
import { getAccountClient, makeSupabaseClient } from "../supabase";
import { resolveMediaSource } from "../mediaCache";
import { SupabaseV3MediaTransport, V3_PRIVATE_MEDIA_BUCKET, type V3MediaStorageClient } from "./supabase/V3MediaTransport";
import { IndexedDbRecordRepository } from "./indexedDb/recordRepository";
import { IndexedDbRevisionLedger } from "./indexedDb/revisionLedger";
import { SupabaseV3RecordAdapter, type V3RpcClient } from "./supabase/V3CloudRecordAdapter";
import { auditSyncReadOnly, type ReadOnlySyncAudit } from "../core/application/auditSyncReadOnly";
import { reviewMigrationReadOnly, type MigrationReview } from "../core/application/reviewMigrationReadOnly";
import { synchronizeWithLedger } from "../core/application/synchronizeWithLedger";
import { bootstrapEquivalentBaselines, type BaselineBootstrapReport } from "../core/application/bootstrapEquivalentBaselines";
import type { SyncRunResult } from "../core/application/synchronizeRecords";

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

  /** Metadata-only V2 adoption: never transfers, edits or removes an archive. */
  async bootstrapMatchingHistory(): Promise<BaselineBootstrapReport> {
    return bootstrapEquivalentBaselines(this.local, this.remote, this.ledger);
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
  provider: "personal" | "account",
): Promise<V3SyncRuntime> {
  const scope = currentStorageScope();
  if (!scope.trim()) throw new Error("An authenticated and scoped local archive is required");

  let client: V3RpcClient;
  let identity: string;
  let mediaTransport: SupabaseV3MediaTransport | undefined;
  let assertIdentity: () => Promise<void>;
  if (provider === "account") {
    const account = getAccountClient();
    const { data, error } = await account.auth.getUser();
    if (error || !data.user?.id) throw new Error("Sign in before preparing V3 account synchronization");
    if (currentStorageScope() !== scope || scope !== data.user.id.toLowerCase()) {
      throw new Error("Authenticated user and active storage account do not match");
    }
    const openingUser = data.user.id.toLowerCase();
    identity = (import.meta.env.VITE_ACCOUNT_SUPABASE_URL || "").trim().toLowerCase() + "|user:" + openingUser;
    client = account as unknown as V3RpcClient;
    assertIdentity = async () => {
      if (currentStorageScope() !== scope) throw new Error("V3_ACCOUNT_SESSION_CHANGED");
      const { data: checked, error: checkError } = await account.auth.getUser();
      if (checkError || checked.user?.id.toLowerCase() !== openingUser || currentStorageScope() !== scope) {
        throw new Error("V3_ACCOUNT_SESSION_CHANGED");
      }
    };
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
    );
  }

  if (currentStorageScope() !== scope) throw new Error("Account switched during V3 runtime construction");
  const local = new IndexedDbRecordRepository(scope);
  const remote = new SupabaseV3RecordAdapter(client, provider, identity, scope, mediaTransport, assertIdentity);
  const ledger = await IndexedDbRevisionLedger.create(scope, provider, identity);
  return new V3SyncRuntime(local, remote, ledger);
}
