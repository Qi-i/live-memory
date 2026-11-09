import type { CloudRecordAdapter, CloudRecordEnvelope } from "../ports/CloudRecordAdapter";
import type { RecordRepository } from "../ports/RecordRepository";
import type { RevisionLedger } from "../ports/RevisionLedger";
import { recordRevision } from "../sync/revision";

/**
 * Adopt verifiably identical V2 local/cloud records into the V3 metadata ledger.
 * This changes no archive, remote payload, Storage object or V2 sync setting.
 * Different/missing records NEVER obtain a fabricated common ancestor.
 */
export interface BaselineBootstrapReport {
  localRecords: number;
  remoteRecords: number;
  alreadyBased: number;
  created: number;
  locallyAbsent: number;
  remotelyAbsent: number;
  divergent: number;
  deferred: number;
}

function uniqueById<T>(items: T[], id: (item: T) => string): Map<string, T> {
  const entries = new Map<string, T>();
  for (const item of items) {
    const key = id(item);
    if (!key || entries.has(key)) {
      throw new Error("V3_BASELINE_INVALID_INVENTORY: missing or repeated ID");
    }
    entries.set(key, item);
  }
  return entries;
}

export async function bootstrapEquivalentBaselines(
  local: Pick<RecordRepository, "scope" | "list">,
  cloud: Pick<CloudRecordAdapter, "provider" | "identity" | "accountScope" | "includeMedia" | "list">,
  ledger: RevisionLedger,
): Promise<BaselineBootstrapReport> {
  if (!local.scope || local.scope !== cloud.accountScope ||
      local.scope !== ledger.accountScope ||
      cloud.provider !== ledger.provider || cloud.identity !== ledger.identity) {
    throw new Error("V3 baseline bootstrap identity mismatch");
  }

  const initial = await ledger.snapshot();
  const [onDevice, inCloud] = await Promise.all([local.list(), cloud.list()]);
  const device = uniqueById(onDevice, (row) => row.id);
  const remote = uniqueById(inCloud, (row) => row.record.id);
  const result: BaselineBootstrapReport = {
    localRecords: onDevice.length,
    remoteRecords: inCloud.length,
    alreadyBased: 0,
    created: 0,
    locallyAbsent: 0,
    remotelyAbsent: 0,
    divergent: 0,
    deferred: 0,
  };

  const potential: Array<{ id: string; digest: string; remoteRevision: string }> = [];
  for (const [id, row] of device) {
    const other = remote.get(id);
    if (!other) { result.remotelyAbsent += 1; continue; }
    if (initial.has(id)) { result.alreadyBased += 1; continue; }
    const [localDigest, remoteDigest] = await Promise.all([
      recordRevision(row, cloud.includeMedia),
      recordRevision(other.record, cloud.includeMedia),
    ]);
    if (localDigest !== remoteDigest) { result.divergent += 1; continue; }
    potential.push({ id, digest: remoteDigest, remoteRevision: other.serverRevision });
  }
  for (const id of remote.keys()) {
    if (!device.has(id)) result.locallyAbsent += 1;
  }

  if (!potential.length) return result;

  // Recheck both sources just before advancing the baseline. This is safe even
  // during a V2 session: a moving record is deferred, not silently adopted.
  const [deviceAgain, remoteAgain] = await Promise.all([local.list(), cloud.list()]);
  const latestDevice = uniqueById(deviceAgain, (row) => row.id);
  const latestRemote = uniqueById<CloudRecordEnvelope>(remoteAgain, (row) => row.record.id);
  const verified: Array<{ id: string; revision: string }> = [];
  for (const item of potential) {
    const current = latestDevice.get(item.id);
    const other = latestRemote.get(item.id);
    if (!current || !other || other.serverRevision !== item.remoteRevision) {
      result.deferred += 1;
      continue;
    }
    const [localDigest, remoteDigest] = await Promise.all([
      recordRevision(current, cloud.includeMedia),
      recordRevision(other.record, cloud.includeMedia),
    ]);
    if (localDigest !== item.digest || remoteDigest !== item.digest) {
      result.deferred += 1;
      continue;
    }
    verified.push({ id: item.id, revision: item.digest });
  }

  if (verified.length) {
    const committed = await ledger.commitIfUnchanged(initial, verified);
    result.created = committed.acknowledgedIds.length;
    result.deferred += committed.deferredIds.length;
  }
  return result;
}
