import type { EventRecord } from "../../domain";
import { stableSerialize } from "../../core/sync/revision";
import type { V3MediaTransport } from "./V3MediaTransport";
import {
  RemoteRevisionChanged,
  type CloudRecordAdapter,
  type CloudRecordEnvelope,
} from "../../core/ports/CloudRecordAdapter";

/**
 * Minimal Supabase RPC surface, injected to keep authentication and owner-key
 * configuration out of the application layer. Only existing V2 table names are
 * used; the V3 columns and procedures are not installed in production yet.
 */
interface RpcResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
export interface V3RpcClient {
  from(table: string): {
    select(columns: string): {
      order(column: string, options: { ascending: boolean }): {
        range(from: number, through: number): PromiseLike<RpcResult>;
      };
    };
  };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}
interface V3Row {
  id: string;
  payload: EventRecord;
  v3_revision: number;
}

/** Strictly fail if the V3 schema / CAS RPC has not been deployed and audited. */
function parseRow(input: unknown): CloudRecordEnvelope {
  if (!input || typeof input !== "object") throw new Error("V3 server returned an invalid record");
  const row = input as Partial<V3Row>;
  if (
    typeof row.id !== "string" || !row.id ||
    !row.payload || typeof row.payload !== "object" ||
    row.payload.id !== row.id ||
    !Number.isSafeInteger(row.v3_revision) || Number(row.v3_revision) < 1
  ) {
    throw new Error("V3 server record is missing a valid ID or version; sync refused");
  }
  return { record: row.payload, serverRevision: String(row.v3_revision) };
}

function rpcFailure(message: string): Error {
  if (message.includes("V3_REVISION_CONFLICT") || message.includes("V3_SECURE_REVISION_CONFLICT")) return new RemoteRevisionChanged();
  return new Error("V3 cloud operation failed: " + message);
}

export class SupabaseV3RecordAdapter implements CloudRecordAdapter {
  readonly includeMedia: boolean;
  constructor(
    private readonly client: V3RpcClient,
    readonly provider: "personal" | "account" | "secure-account",
    readonly identity: string,
    readonly accountScope: string,
    private readonly mediaTransport?: V3MediaTransport,
    private readonly assertIdentity?: () => Promise<void>,
  ) {
    if (!identity.trim() || !accountScope.trim()) throw new Error("V3 cloud identity and account scope are mandatory");
    if (provider !== "personal" && (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(accountScope) || !assertIdentity)) {
      throw new Error("V3_ACCOUNT_SCOPE_GUARD_REQUIRED");
    }
    this.includeMedia = provider === "personal" || provider === "secure-account";
  }

  private async guardIdentity(): Promise<void> {
    if (this.assertIdentity) await this.assertIdentity();
    this.mediaTransport?.assertScope();
  }

  /**
   * A client-side "V2 disabled" boolean is not a writer fence. The database
   * must have an immutable owner cutover marker before V3 may write.
   */
  async writerMode(): Promise<"v2" | "v3"> {
    await this.guardIdentity();
    const fn = this.provider === "personal"
      ? "live_memory_v3_mode_personal" : "live_memory_v3_mode_account";
    const { data, error } = await this.client.rpc(fn, {});
    await this.guardIdentity();
    if (error) throw rpcFailure(error.message);
    if (data !== "v2" && data !== "v3") {
      throw new Error("V3_SERVER_CUTOVER_UNAVAILABLE: Writer mode cannot be verified");
    }
    return data;
  }

  /**
   * Offset paging is not a database snapshot: legacy V2 writers can change a
   * row (or insert another ID) between pages. Read the full inventory twice,
   * then fail closed if its IDs, server revisions, or contents drifted.
   * This does not replace CAS at write-time, but prevents applying an
   * internally inconsistent multi-page response as a deletion/recovery.
   */
  async list(): Promise<CloudRecordEnvelope[]> {
    await this.guardIdentity();
    const first = await this.scanAllPages();
    const verified = await this.scanAllPages();
    await this.guardIdentity();
    if (first.length !== verified.length) {
      throw new Error("V3_REMOTE_INVENTORY_CHANGED: Cloud records changed during pagination; retry");
    }
    for (let i = 0; i < first.length; i += 1) {
      if (first[i].record.id !== verified[i].record.id ||
          first[i].serverRevision !== verified[i].serverRevision ||
          stableSerialize(first[i].record) !== stableSerialize(verified[i].record)) {
        throw new Error("V3_REMOTE_INVENTORY_CHANGED: Cloud records changed during pagination; retry");
      }
    }
    if (!this.includeMedia || !this.mediaTransport) {
      await this.guardIdentity();
      return verified;
    }
    // Keep signing work bounded instead of opening a request for every image
    // at once (which can overwhelm private Storage and lose failure signals).
    const hydrated: CloudRecordEnvelope[] = new Array(verified.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, verified.length) }, async () => {
      while (cursor < verified.length) {
        const index = cursor++;
        this.mediaTransport!.assertScope();
        hydrated[index] = { ...verified[index],
          record: await this.mediaTransport!.hydrate(verified[index].record) };
      }
    }));
    await this.guardIdentity();
    return hydrated;
  }

  async prepareIncoming(record: EventRecord): Promise<EventRecord> {
    await this.guardIdentity();
    if (this.includeMedia) {
      if (!this.mediaTransport) throw new Error("V3_OFFLINE_MEDIA_TRANSPORT_REQUIRED");
      await this.mediaTransport.ensureOffline(record);
    }
    await this.guardIdentity();
    return record;
  }

  private async scanAllPages(): Promise<CloudRecordEnvelope[]> {
    await this.guardIdentity();
    const table = this.provider === "personal" ? "echo_passkey_records"
      : this.provider === "secure-account" ? "live_memory_v3_secure_records"
      : "echo_text_backups";
    // Existing tenant RLS restricts visible rows. No service-role credentials.
    // PostgREST caps response lengths: a short list is NOT proof that a missing
    // record was deleted, so every page must be retrieved before reconciliation.
    const pageSize = 500;
    const all: CloudRecordEnvelope[] = [];
    let lastId: string | null = null;
    for (let start = 0; start < 500_000; start += pageSize) {
      await this.guardIdentity();
      const { data, error } = await this.client.from(table)
        .select("id,payload,v3_revision")
        .order("id", { ascending: true })
        .range(start, start + pageSize - 1);
      await this.guardIdentity();
      if (error) throw rpcFailure(error.message);
      if (!Array.isArray(data)) throw new Error("V3 remote list returned an invalid result");
      for (const item of data) {
        const row = parseRow(item);
        if (lastId !== null && row.record.id <= lastId) {
          throw new Error("V3_REMOTE_INVENTORY_CHANGED: Cloud pagination order shifted or repeated an ID");
        }
        lastId = row.record.id;
        all.push(row);
      }
      if (data.length < pageSize) return all;
    }
    throw new Error("V3 cloud record count exceeded the safe page cap; no data was modified");
  }

  async compareAndSwap(record: EventRecord, expected: string | null): Promise<CloudRecordEnvelope> {
    await this.guardIdentity();
    if (!record.id?.trim()) throw new Error("Record ID is required for V3 CAS");
    if (expected !== null && (!/^[1-9]\d*$/.test(expected) || !Number.isSafeInteger(Number(expected)))) {
      throw new Error("Invalid server revision, refusing cloud overwrite");
    }
    let prepared = record;
    if (this.includeMedia && this.mediaTransport) {
      // Stage every local image first. Any failed file prevents the CAS call.
      // A second writer can still win CAS; staged content stays immutable and
      // must NOT be deleted without a separate delayed-reference audit.
      const assets = [];
      for (const asset of record.media) {
        this.mediaTransport.assertScope();
        assets.push(await this.mediaTransport.stage(record.id, asset));
      }
      prepared = { ...record, media: assets };
    }
    if (this.includeMedia && (!Array.isArray(prepared.media) ||
        prepared.media.some((asset) => !asset.storagePath))) {
      throw new Error("V3_MEDIA_UPLOAD_REQUIRED: Every media item must have a durable private Storage path before CAS");
    }

    // Server JSON contains only private Storage paths, never raw image bytes
    // or expiring signed URLs. The local result retains its renderable src.
    const payload: EventRecord = this.includeMedia
      ? {
        ...prepared,
        media: prepared.media.map((asset) => asset.storagePath
          ? { ...asset, src: "" }
          : asset),
      }
      : { ...prepared, media: [], mediaTombstones: undefined };
    const fn = this.provider === "personal" ? "live_memory_v3_cas_personal"
      : this.provider === "secure-account" ? "live_memory_v3_cas_secure_account"
      : "live_memory_v3_cas_account_scoped";
    const args: Record<string, unknown> = {
      p_id: prepared.id, p_payload: payload,
      p_expected_revision: expected === null ? null : Number(expected),
    };
    if (this.provider !== "personal") args.p_expected_user = this.accountScope;
    await this.guardIdentity();
    const { data, error } = await this.client.rpc(fn, args);
    await this.guardIdentity();
    if (error) throw rpcFailure(error.message);
    const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
    const committed = parseRow(row);
    if (!this.includeMedia || !this.mediaTransport) return committed;
    const localMedia = new Map(prepared.media.map(asset => [asset.id, asset]));
    // Reapply client-side display bytes only if the server acknowledged the
    // expected immutable object path. No image bytes are sent via the RPC.
    return { ...committed, record: {
      ...committed.record,
      media: committed.record.media.map(asset => {
        const local = localMedia.get(asset.id);
        return local && local.storagePath === asset.storagePath
          ? { ...asset, src: local.src, source: local.source } : asset;
      }),
    } };
  }
}
