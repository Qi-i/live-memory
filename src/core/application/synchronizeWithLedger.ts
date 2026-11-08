import type { CloudRecordAdapter } from "../ports/CloudRecordAdapter";
import type { RecordRepository } from "../ports/RecordRepository";
import type { RevisionLedger } from "../ports/RevisionLedger";
import type { RevisionEntry } from "../sync/baselines";
import { synchronizeRecords, type SyncRunResult } from "./synchronizeRecords";

/**
 * Production entry point for V3 record reconciliation. Takes an immutable,
 * provider-scoped baseline snapshot, then conditionally commits only digests
 * that have not been acknowledged by another tab in the meantime.
 *
 * A process crash after data application but before ledger commit is safe:
 * the next read detects equal remote/local content and acknowledges it.
 */
export async function synchronizeWithLedger(
  local: RecordRepository,
  cloud: CloudRecordAdapter,
  ledger: RevisionLedger,
): Promise<SyncRunResult> {
  if (!local.scope || ledger.accountScope !== local.scope
    || cloud.accountScope !== local.scope
    || ledger.provider !== cloud.provider
    || ledger.identity !== cloud.identity) {
    throw new Error("V3 ledger identity mismatch; cloud reconciliation refused");
  }

  const baseline = await ledger.snapshot();
  const pending: RevisionEntry[] = [];
  const result = await synchronizeRecords(local, cloud, {
    read: (id: string) => baseline.get(id),
    acknowledge(items: RevisionEntry[]) {
      pending.push(...items);
    },
  });
  const commit = await ledger.commitIfUnchanged(baseline, pending);
  const deferred = new Set([...result.deferredIds, ...commit.deferredIds]);
  return { ...result, deferredIds: Array.from(deferred) };
}
