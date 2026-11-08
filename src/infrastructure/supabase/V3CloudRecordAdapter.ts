import type { EventRecord } from "../../domain";
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
  from(table: string): { select(columns: string): PromiseLike<RpcResult> };
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
  ) {
    if (!identity.trim() || !accountScope.trim()) throw new Error("V3 cloud identity and account scope are mandatory");
    this.includeMedia = provider === "personal";
  }

  async list(): Promise<CloudRecordEnvelope[]> {
    const table = this.provider === "personal" ? "echo_passkey_records" : "echo_text_backups";
    // The caller must supply its own configured auth / owner-key client.
    // Existing RLS restricts visible rows. No service_role is used.
    const { data, error } = await this.client.from(table).select("id,payload,v3_revision");
    if (error) throw rpcFailure(error.message);
    if (!Array.isArray(data)) throw new Error("V3 remote list returned an invalid result");
    return data.map(parseRow);
  }

  async compareAndSwap(record: EventRecord, expected: string | null): Promise<CloudRecordEnvelope> {
    if (!record.id?.trim()) throw new Error("Record ID is required for V3 CAS");
    if (expected !== null && (!/^[1-9]\d*$/.test(expected) || !Number.isSafeInteger(Number(expected)))) {
      throw new Error("Invalid server revision, refusing cloud overwrite");
    }
    // The CAS RPC only commits JSON metadata. Image bytes must first be
    // uploaded by the media pipeline, not smuggled into public JSON rows.
    if (this.includeMedia && record.media.some((asset) =>
      !asset.storagePath && /^(?:data:|blob:)/i.test(asset.src)
    )) {
      throw new Error("V3_MEDIA_UPLOAD_REQUIRED: Upload local images before committing the record");
    }
    const payload: EventRecord = this.includeMedia
      ? {
        ...record,
        media: record.media.map((asset) => asset.storagePath
          ? { ...asset, src: "" }
          : asset),
      }
      : {
        ...record, media: [], mediaTombstones: undefined,
      };
    const fn = this.provider === "personal" ? "live_memory_v3_cas_personal" : "live_memory_v3_cas_account";
    const args = { p_id: record.id, p_payload: payload, p_expected_revision: expected === null ? null : Number(expected) };
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw rpcFailure(error.message);
    const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
    return parseRow(row);
  }
}
