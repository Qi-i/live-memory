import type { EventRecord } from "../../domain";

/**
 * Each provider must implement server-side conditional writes. An unconditional
 * upsert is forbidden: two devices may overwrite one another between reading
 * the cloud and uploading an updated record.
 */
export interface CloudRecordEnvelope {
  record: EventRecord;
  /** Server-generated opaque revision / ETag, not the device clock. */
  serverRevision: string;
}

export interface CloudRecordAdapter {
  readonly provider: "personal" | "account" | "secure-account";
  readonly identity: string;
  readonly accountScope: string;
  readonly includeMedia: boolean;
  list(): Promise<CloudRecordEnvelope[]>;
  /** Materialize and validate incoming private media before the local row is acknowledged. */
  prepareIncoming?(record: EventRecord): Promise<EventRecord>;
  /**
   * expected=null means create only if absent. Otherwise the server must
   * update only if its current revision matches the expected value.
   * Mismatches MUST fail, not silently become unconditional upserts.
   */
  compareAndSwap(record: EventRecord, expected: string | null): Promise<CloudRecordEnvelope>;
}

/** Returned only for a rejected optimistic concurrency precondition. */
export class RemoteRevisionChanged extends Error {
  constructor(message = "Remote record revision changed during the upload") {
    super(message);
    this.name = "RemoteRevisionChanged";
  }
}
