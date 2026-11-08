import type { RecordRepository } from "../ports/RecordRepository";
import type { CloudRecordAdapter } from "../ports/CloudRecordAdapter";
import type { RevisionBaselineStore } from "../sync/baselines";
import { recordRevision } from "../sync/revision";
import { decideRecordSync, type RecordSyncAction } from "../sync/policy";

/** No record content or private IDs leave this report. */
export interface ReadOnlySyncAudit {
  provider: "personal" | "account";
  checkedRecords: number;
  localRecords: number;
  remoteRecords: number;
  actions: Record<RecordSyncAction, number>;
  unresolved: number;
  /** Diagnostic only. This is NOT permission to enable cloud writes. */
  requiresMigrationReview: boolean;
}

const ALL_ACTIONS: RecordSyncAction[] = [
  "unchanged", "push-new", "pull-new", "push", "pull",
  "conflict", "unbased-divergence", "defer-absence",
];

/**
 * Migration preflight: compare local and remote through *the same* semantic
 * revisions used by the new engine, but do not mutate cloud, IndexedDB or the
 * last-acknowledged baseline. No data is printed or included in the report.
 */
export async function auditSyncReadOnly(
  local: Pick<RecordRepository, "scope" | "list">,
  cloud: Pick<CloudRecordAdapter, "provider" | "identity" | "accountScope" | "includeMedia" | "list">,
  baselines: Pick<RevisionBaselineStore, "read">,
): Promise<ReadOnlySyncAudit> {
  if (!local.scope || !cloud.identity.trim() || cloud.accountScope !== local.scope) {
    throw new Error("Sync audit account or provider identity mismatch");
  }
  const [localRecords, cloudRows] = await Promise.all([local.list(), cloud.list()]);
  const locals = new Map(localRecords.map((row) => [row.id, row]));
  const remotes = new Map(cloudRows.map((row) => [row.record.id, row.record]));
  if (locals.size !== localRecords.length || remotes.size !== cloudRows.length) {
    throw new Error("Duplicate record IDs: audit cannot establish safe revisions");
  }
  const actions = Object.fromEntries(ALL_ACTIONS.map((action) => [action, 0])) as Record<RecordSyncAction, number>;
  const ids = new Set([...locals.keys(), ...remotes.keys()]);
  for (const id of ids) {
    const onDevice = locals.get(id);
    const inCloud = remotes.get(id);
    const decision = decideRecordSync({
      localRevision: onDevice ? await recordRevision(onDevice, cloud.includeMedia) : undefined,
      remoteRevision: inCloud ? await recordRevision(inCloud, cloud.includeMedia) : undefined,
      acknowledgedRevision: baselines.read(id),
    });
    actions[decision.action] += 1;
  }
  const unresolved = actions.conflict + actions["unbased-divergence"] + actions["defer-absence"];
  return {
    provider: cloud.provider,
    checkedRecords: ids.size,
    localRecords: localRecords.length,
    remoteRecords: cloudRows.length,
    actions,
    unresolved,
    requiresMigrationReview: unresolved > 0,
  };
}
