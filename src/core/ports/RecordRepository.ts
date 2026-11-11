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
/** A newer edit exists in this device's scoped database. */
export class LocalRevisionChanged extends Error {
  constructor(readonly recordId: string) {
    super("The record changed after the editor was opened; reload or review the newer version.");
    this.name = "LocalRevisionChanged";
  }
}

export interface RecordRepository {
  readonly scope: string;
  list(): Promise<EventRecord[]>;
  /** Restricted to controlled migrations and imports; not for interactive editing. */
  upsert(record: EventRecord): Promise<void>;
  /**
   * Atomically save only if the current record still matches the last version
   * seen by this editor. null means create only if the ID does not yet exist.
   * Does not treat volatile sync timestamps as user edits.
   */
  saveIfUnchanged(record: EventRecord, expectedSnapshot: EventRecord | null): Promise<void>;
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
