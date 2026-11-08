import type { EventRecord } from "../../domain";

export interface AppliedRemoteBatch {
  records: EventRecord[];
  acceptedIds: string[];
  deferredIds: string[];
}

/**
 * UI and sync services issue explicit commands to this port. No feature page
 * is permitted to clear the entire records store after a network response.
 */
export interface RecordRepository {
  readonly scope: string;
  list(): Promise<EventRecord[]>;
  upsert(record: EventRecord): Promise<void>;
  /**
   * One indexed transaction: re-read current records, compare with request
   * snapshot, conditionally apply individual remote rows, commit atomically.
   * Never silently delete a row missing in a remote query response.
   */
  applyRemoteIfUnchanged(
    requestSnapshot: EventRecord[],
    remoteResult: EventRecord[],
    options?: { includeMedia?: boolean },
  ): Promise<AppliedRemoteBatch>;
}
