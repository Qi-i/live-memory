import { currentStorageScope } from "../../storage";
import { createBaselineKey, type RevisionEntry } from "../../core/sync/baselines";
import type { LedgerCommitResult, LedgerSnapshot, RevisionLedger } from "../../core/ports/RevisionLedger";

const DB_NAME = "live-memory-v3-revision-ledger";
const DB_VERSION = 1;
const STORE = "acknowledgements";
const DIGEST = /^[a-f0-9]{64}$/;

interface StoredEntry {
  key: string;
  revision: string;
}

/**
 * Dedicated V3 metadata DB. IMPORTANT: never bump the V2 archive DB version:
 * existing V2 clients open it with version 1 and would otherwise fail.
 *
 * Each commit compares the provider-scoped expected digests against current
 * values in the SAME readwrite transaction as the conditional updates.
 * No private record bodies, media or cloud credentials are stored here.
 */
export class IndexedDbRevisionLedger implements RevisionLedger {
  private constructor(
    readonly accountScope: string,
    readonly provider: "personal" | "account" | "secure-account",
    readonly identity: string,
    private readonly prefix: string,
  ) {}

  static async create(
    accountScope: string,
    provider: "personal" | "account" | "secure-account",
    identity: string,
  ): Promise<IndexedDbRevisionLedger> {
    const prefix = await createBaselineKey(accountScope, provider, identity);
    return new IndexedDbRevisionLedger(accountScope, provider, identity, prefix + ":");
  }

  async snapshot(): Promise<LedgerSnapshot> {
    this.checkScope();
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAll();
      let snapshot = new Map<string, string>();
      let validationError: Error | null = null;
      request.onsuccess = () => {
        if (currentStorageScope() !== this.accountScope) {
          validationError = new Error("Account switched during revision ledger read");
          tx.abort();
          return;
        }
        try {
          snapshot = this.readPartition(request.result as StoredEntry[]);
        } catch (error) {
          validationError = error as Error;
          tx.abort();
        }
      };
      tx.oncomplete = () => { db.close(); resolve(snapshot); };
      tx.onabort = () => { db.close(); reject(validationError ?? tx.error ?? new Error("Ledger read aborted")); };
      tx.onerror = () => { db.close(); reject(validationError ?? tx.error ?? new Error("Ledger read failed")); };
    });
  }

  async commitIfUnchanged(
    expected: LedgerSnapshot,
    entries: RevisionEntry[],
  ): Promise<LedgerCommitResult> {
    this.checkScope();
    const pending = new Map<string, string>();
    for (const { id, revision } of entries) {
      if (!id.trim() || !DIGEST.test(revision)) {
        throw new Error("Invalid V3 acknowledgement; ledger was not advanced");
      }
      const previous = pending.get(id);
      if (previous && previous !== revision) {
        throw new Error("Conflicting acknowledged revisions for the same record");
      }
      pending.set(id, revision);
    }
    if (!pending.size) return { acknowledgedIds: [], deferredIds: [] };

    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const request = store.getAll();
      const acknowledgedIds: string[] = [];
      const deferredIds: string[] = [];
      let validationError: Error | null = null;
      request.onsuccess = () => {
        if (currentStorageScope() !== this.accountScope) {
          validationError = new Error("Account switched before revision ledger commit");
          tx.abort();
          return;
        }
        try {
          const current = this.readPartition(request.result as StoredEntry[]);
          for (const [id, revision] of pending) {
            if (current.get(id) !== expected.get(id)) {
              deferredIds.push(id);
              continue;
            }
            store.put({ key: this.prefix + id, revision } satisfies StoredEntry);
            acknowledgedIds.push(id);
          }
        } catch (error) {
          validationError = error as Error;
          tx.abort();
        }
      };
      tx.oncomplete = () => { db.close(); resolve({ acknowledgedIds, deferredIds }); };
      tx.onabort = () => { db.close(); reject(validationError ?? tx.error ?? new Error("Ledger commit aborted")); };
      tx.onerror = () => { db.close(); reject(validationError ?? tx.error ?? new Error("Ledger commit failed")); };
    });
  }

  private readPartition(rows: StoredEntry[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const row of rows) {
      if (!row.key.startsWith(this.prefix)) continue;
      const id = row.key.slice(this.prefix.length);
      if (!id || !DIGEST.test(row.revision)) {
        throw new Error("V3 revision ledger contains damaged metadata; sync refused");
      }
      if (result.has(id)) throw new Error("Duplicate V3 ledger record key");
      result.set(id, row.revision);
    }
    return result;
  }

  private checkScope(): void {
    if (currentStorageScope() !== this.accountScope) {
      throw new Error("V3 ledger account scope does not match active user");
    }
  }

  private async open(): Promise<IDBDatabase> {
    this.checkScope();
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: "key" });
        }
      };
      request.onerror = () => reject(request.error ?? new Error("Revision ledger unavailable"));
      request.onsuccess = () => {
        if (currentStorageScope() !== this.accountScope) {
          request.result.close();
          reject(new Error("User changed while opening revision ledger"));
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }
}
