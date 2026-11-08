import type { RevisionEntry } from "../sync/baselines";

/** A point-in-time set of acknowledged REMOTE content digests. */
export type LedgerSnapshot = ReadonlyMap<string, string>;

export interface LedgerCommitResult {
  acknowledgedIds: string[];
  deferredIds: string[];
}

/**
 * Exactly one account+provider identity owns a ledger. The implementation
 * must check all expected revisions INSIDE an atomic local transaction, not
 * with a separate asynchronous get() followed by an unconditional put().
 */
export interface RevisionLedger {
  readonly accountScope: string;
  readonly provider: "personal" | "account";
  readonly identity: string;
  snapshot(): Promise<LedgerSnapshot>;
  commitIfUnchanged(
    expected: LedgerSnapshot,
    entries: RevisionEntry[],
  ): Promise<LedgerCommitResult>;
}
