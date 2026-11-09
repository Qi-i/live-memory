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
  if (message.includes("V3_REVISION_CONFLICT")) return new RemoteRevisionChanged();
  return new Error("V3 cloud operation failed: " + message);
}

export class SupabaseV3RecordAdapter implements CloudRecordAdapter {
  readonly includeMedia: boolean;
  constructor(
    private readonly client: V3RpcClient,
    readonly provider: "personal" | "account",
    readonly identity: string,
    readonly accountScope: string,
    private readonly mediaTransport?: V3MediaTransport,
  ) {
    if (!identity.trim() || !accountScope.trim()) throw new Error("V3 cloud identity and account scope are mandatory");
    this.includeMedia = provider === "personal";
  }

  /**
   * Offset paging is not a database snapshot: legacy V2 writers can change a
   * row (or insert another ID) between pages. Read the full inventory twice,
   * then fail closed if its IDs, server revisions, or contents drifted.
   * This does not replace CAS at write-time, but prevents applying an
   * internally inconsistent multi-page response as a deletion/recovery.
   */
  async list(): Promise<CloudRecordEnvelope[]> {
    const first = await this.scanAllPages();
    const verified = await this.scanAllPages();
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
    if (!this.includeMedia || !this.mediaTransport) return verified;
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
    this.mediaTransport.assertScope();
    return hydrated;
  }

  private async scanAllPages(): Promise<CloudRecordEnvelope[]> {
    const table = this.provider === "personal" ? "echo_passkey_records" : "echo_text_backups";
    // Existing tenant RLS restricts visible rows. No service-role credentials.
    // PostgREST caps response lengths: a short list is NOT proof that a missing
    // record was deleted, so every page must be retrieved before reconciliation.
    const pageSize = 500;
    const all: CloudRecordEnvelope[] = [];
    let lastId: string | null = null;
    for (let start = 0; start < 500_000; start += pageSize) {
      const { data, error } = await this.client.from(table)
        .select("id,payload,v3_revision")
        .order("id", { ascending: true })
        .range(start, start + pageSize - 1);
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
    if (!record.id?.trim()) throw new Error("Record ID is required for V3 CAS");
    if (expected !== null && (!/^[1-9]\d*$/.test(expected) || !Number.isSafeInteger(Number(expected)))) {
      throw new Error("Invalid server revision, refusing cloud overwrite");
    }
    this.mediaTransport?.assertScope();
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
    if (this.includeMedia && prepared.media.some((asset) =>
      /^(?:data:|blob:)/i.test(asset.src) && !asset.storagePath
    )) {
      throw new Error("V3_MEDIA_UPLOAD_REQUIRED: Upload local images before committing the record");
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
    const fn = this.provider === "personal" ? "live_memory_v3_cas_personal" : "live_memory_v3_cas_account";
    const args = { p_id: prepared.id, p_payload: payload, p_expected_revision: expected === null ? null : Number(expected) };
    this.mediaTransport?.assertScope();
    const { data, error } = await this.client.rpc(fn, args);
    this.mediaTransport?.assertScope();
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
