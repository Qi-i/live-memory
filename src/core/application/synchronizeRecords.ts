import type { EventRecord } from "../../domain";
import { RemoteRevisionChanged, type CloudRecordAdapter, type CloudRecordEnvelope } from "../ports/CloudRecordAdapter";
import type { RecordRepository } from "../ports/RecordRepository";
import type { RevisionBaselineStore, RevisionEntry } from "../sync/baselines";
import { recordRevision, recordContentEqual } from "../sync/revision";
import { decideRecordSync } from "../sync/policy";
import type { RecordSyncAction, SyncActivity } from "../sync/policy";

export interface SyncReviewItem {
  recordId: string;
  action: Extract<RecordSyncAction, "conflict" | "unbased-divergence">;
  local: EventRecord;
  remote: EventRecord;
}

export interface SyncRunResult {
  downloadedIds: string[];
  uploadedIds: string[];
  deferredIds: string[];
  reviews: SyncReviewItem[];
  activity: SyncActivity;
}

/**
 * V3 application service. One sync round:
 *  1. Snapshot local and remote state without mutating either;
 *  2. Resolve each record against the last REMOTELY ACKNOWLEDGED revision;
 *  3. Conditionally write uploads using cloud CAS;
 *  4. Atomically apply only safe downloads against current local records;
 *  5. Acknowledge what the server actually accepted.
 *
 * Existing V2 adapters are intentionally NOT wired to this service until the
 * CAS RPC and safe baseline migration are complete. This service never assumes
 * "newer timestamp wins" and never clears the local record store.
 */
export async function synchronizeRecords(
  local: RecordRepository,
  cloud: CloudRecordAdapter,
  baselines: Pick<RevisionBaselineStore, "read" | "acknowledge">,
): Promise<SyncRunResult> {
  if (!local.scope || cloud.accountScope !== local.scope) {
    throw new Error("Sync was refused because the account scopes are different");
  }
  if (!cloud.identity.trim()) throw new Error("A cloud provider identity is required");

  const snapshot = await local.list();
  const remoteRecords = await cloud.list();
  // The core must NOT assume every transport returns trustworthy unique IDs.
  // A malformed/duplicate row could collapse in Map() and cause the wrong
  // cloud revision to overwrite another device's archive. Abort the entire
  // round BEFORE any CAS, local transaction or baseline acknowledgement.
  if (!Array.isArray(snapshot) || !Array.isArray(remoteRecords) ||
      snapshot.some(record => typeof record?.id !== "string" || !record.id.trim()) ||
      remoteRecords.some(row => typeof row?.record?.id !== "string" ||
        !row.record.id.trim() || typeof row.serverRevision !== "string" ||
        !/^[1-9]\d*$/.test(row.serverRevision))) {
    throw new Error("V3_SYNC_AMBIGUOUS_SNAPSHOT");
  }
  const localById = new Map(snapshot.map((record) => [record.id, record]));
  const remoteById = new Map(remoteRecords.map((row) => [row.record.id, row]));
  if (localById.size !== snapshot.length || remoteById.size !== remoteRecords.length) {
    throw new Error("V3_SYNC_AMBIGUOUS_SNAPSHOT");
  }
  const allIds = new Set([...localById.keys(), ...remoteById.keys()]);
  const downloadedIds: string[] = [];
  const uploadedIds: string[] = [];
  const deferred = new Set<string>();
  const reviews: SyncReviewItem[] = [];
  const downloadCandidates: EventRecord[] = [];
  const toUpload: Array<{ record: EventRecord; expected: string | null }> = [];
  const toAcknowledge: RevisionEntry[] = [];

  for (const id of allIds) {
    const onDevice = localById.get(id);
    const envelope = remoteById.get(id);
    const inCloud = envelope?.record;
    const decision = decideRecordSync({
      localRevision: onDevice ? await recordRevision(onDevice, cloud.includeMedia) : undefined,
      remoteRevision: inCloud ? await recordRevision(inCloud, cloud.includeMedia) : undefined,
      acknowledgedRevision: baselines.read(id),
    });

    switch (decision.action) {
      case "unchanged":
        if (inCloud) toAcknowledge.push({ id, revision: await recordRevision(inCloud, cloud.includeMedia) });
        break;
      case "pull-new":
      case "pull":
        if (inCloud) downloadCandidates.push(inCloud);
        break;
      case "push-new":
      case "push":
        if (onDevice) toUpload.push({ record: onDevice, expected: envelope?.serverRevision ?? null });
        break;
      case "defer-absence":
        deferred.add(id);
        break;
      case "conflict":
      case "unbased-divergence":
        if (onDevice && inCloud) reviews.push({ recordId: id, action: decision.action, local: onDevice, remote: inCloud });
        break;
    }
  }

  // Compare against LIVE device state before upload. An editor may have saved
  // again while our cloud listing request was in flight.
  for (const candidate of toUpload) {
    const current = (await local.list()).find((record) => record.id === candidate.record.id);
    if (!current || !recordContentEqual(current, candidate.record, cloud.includeMedia)) {
      deferred.add(candidate.record.id);
      continue;
    }
    let acknowledged: CloudRecordEnvelope;
    try {
      // Account-cloud text backups must not receive private photos, ticket scans
      // or media deletion history even if a future adapter forgets to filter.
      const upload = cloud.includeMedia
        ? candidate.record
        : { ...candidate.record, media: [], mediaTombstones: undefined };
      acknowledged = await cloud.compareAndSwap(upload, candidate.expected);
    } catch (error) {
      if (error instanceof RemoteRevisionChanged) {
        // Re-check instead of inventing a conflict from one failed CAS.
        deferred.add(candidate.record.id);
        continue;
      }
      throw error;
    }
    uploadedIds.push(candidate.record.id);
    // The server may have normalized media references. Apply its response only
    // if there has been no new local edit in the meantime.
    const confirmed = await local.applyRemoteIfUnchanged(snapshot, [acknowledged.record], { includeMedia: cloud.includeMedia });
    if (confirmed.deferredIds.length) confirmed.deferredIds.forEach((id) => deferred.add(id));
    toAcknowledge.push({
      id: candidate.record.id,
      revision: await recordRevision(acknowledged.record, cloud.includeMedia),
    });
  }

  if (downloadCandidates.length) {
    // Images must be actual verified offline bytes, not expiring signed URLs,
    // BEFORE any new local record is committed or its baseline acknowledged.
    const durableCandidates: EventRecord[] = [];
    for (const candidate of downloadCandidates) {
      durableCandidates.push(cloud.prepareIncoming
        ? await cloud.prepareIncoming(candidate)
        : candidate);
    }
    const accepted = await local.applyRemoteIfUnchanged(snapshot, durableCandidates, { includeMedia: cloud.includeMedia });
    downloadedIds.push(...accepted.acceptedIds);
    accepted.deferredIds.forEach((id) => deferred.add(id));
    for (const acceptedId of accepted.acceptedIds) {
      const envelope = remoteById.get(acceptedId);
      if (envelope) {
        toAcknowledge.push({
          id: acceptedId,
          revision: await recordRevision(envelope.record, cloud.includeMedia),
        });
      }
    }
  }

  // Acknowledgements are content digests only, not syncedAt=Date.now().
  // Each provider retains a separate baseline store.
  if (toAcknowledge.length) baselines.acknowledge(toAcknowledge);
  const activity: SyncActivity = reviews.length
    ? { type: "conflict", count: reviews.length }
    : downloadedIds.length
      ? { type: "transferred", direction: "pull", changedRecords: downloadedIds.length }
      : uploadedIds.length
        ? { type: "transferred", direction: "push", changedRecords: uploadedIds.length }
        : { type: "connected" };

  return {
    downloadedIds,
    uploadedIds,
    deferredIds: Array.from(deferred),
    reviews,
    activity,
  };
}
