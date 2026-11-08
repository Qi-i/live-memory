import type { EventRecord } from "../../domain";
import { recordContentEqual } from "./revision";

export interface RemoteApplication {
  records: EventRecord[];
  /** IDs whose remote reconciliation can safely advance the local snapshot. */
  acceptedIds: string[];
  /**
   * IDs edited locally while an async request was pending, or whose provenance
   * is ambiguous. They must be retried, not overwritten by the old response.
   */
  deferredIds: string[];
}

function mapById(records: EventRecord[]): Map<string, EventRecord> {
  return new Map(records.map((record) => [record.id, record]));
}

/**
 * Applies only safe remote changes against LIVE local state. Request-time
 * records are used solely as the common comparison point. It never deletes an
 * absent record (permanent deletion requires an explicit command).
 *
 * A caller must additionally fence the account scope before AND after its
 * atomic persistence transaction.
 */
export function applyRemoteAgainstLive(
  requestSnapshot: EventRecord[],
  remoteResult: EventRecord[],
  liveRecords: EventRecord[],
): RemoteApplication {
  const before = mapById(requestSnapshot);
  const live = mapById(liveRecords);
  const acceptedIds: string[] = [];
  const deferredIds: string[] = [];

  for (const remote of remoteResult) {
    const baseline = before.get(remote.id);
    const current = live.get(remote.id);

    if (!current) {
      // A record intentionally removed locally during the request must not
      // reappear merely because the remote response included the old copy.
      if (baseline) {
        deferredIds.push(remote.id);
        continue;
      }
      live.set(remote.id, remote);
      acceptedIds.push(remote.id);
      continue;
    }

    const localChangedDuringRequest = baseline
      ? !recordContentEqual(current, baseline)
      : !recordContentEqual(current, remote);
    const responseDifferentFromRequest = baseline
      ? !recordContentEqual(remote, baseline)
      : false;

    if (!baseline && localChangedDuringRequest) {
      deferredIds.push(remote.id);
      continue;
    }
    if (localChangedDuringRequest) {
      // Both sides changed: do not choose a winner behind the user's back.
      // If only the device changed, preserve its newer content and retry sync.
      if (responseDifferentFromRequest) deferredIds.push(remote.id);
      else deferredIds.push(remote.id);
      continue;
    }

    // This record did not change on device while the request was pending.
    // It is safe to accept even metadata-only acknowledgements (syncedAt).
    live.set(remote.id, remote);
    acceptedIds.push(remote.id);
  }

  return {
    records: Array.from(live.values()).sort((a, b) => b.date.localeCompare(a.date)),
    acceptedIds,
    deferredIds,
  };
}
