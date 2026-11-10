import type { EventRecord } from "../../domain";
import { currentStorageScope, normalizeRecord, storageScopeKey } from "../../storage";
import { LocalRevisionChanged, type RecordRepository, type AppliedRemoteBatch } from "../../core/ports/RecordRepository";
import { recordContentEqual } from "../../core/sync/revision";
import { applyRemoteAgainstLive } from "../../core/sync/applyRemote";

const LEGACY_DB_VERSION = 1;
const RECORD_STORE = "records";
const DB_BASE_NAME = "echo-archive-v2";

/**
 * Compatibility adapter over the existing per-account IndexedDB schema.
 * No database migration, deletion or change to existing record format.
 *
 * All pending writes run in ONE readwrite transaction, with the snapshot check
 * performed from the actual transaction's getAll result. New user edits cannot
 * be overwritten by a network result based on an earlier snapshot.
 */
export class IndexedDbRecordRepository implements RecordRepository {
  constructor(readonly scope: string) {
    if (!scope.trim()) throw new Error("A scoped record repository cannot use the anonymous database");
  }

  async list(): Promise<EventRecord[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORD_STORE, "readonly");
      const req = tx.objectStore(RECORD_STORE).getAll();
      let value: EventRecord[] = [];
      req.onsuccess = () => {
        value = (req.result as EventRecord[]).map(normalizeRecord).sort((a, b) => b.date.localeCompare(a.date));
      };
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Record read aborted")); };
      tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Record read failed")); };
    });
  }

  async upsert(record: EventRecord): Promise<void> {
    const db = await this.open();
    this.checkScope();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORD_STORE, "readwrite");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Record write aborted")); };
      tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Record write failed")); };
      // The transaction has been opened after the scope assertion. Even if
      // navigation changes scopes meanwhile, its store is tied to the old DB.
      tx.objectStore(RECORD_STORE).put(normalizeRecord(record));
    });
  }


  async saveIfUnchanged(record: EventRecord, expectedSnapshot: EventRecord | null): Promise<void> {
    if (expectedSnapshot && expectedSnapshot.id !== record.id) {
      throw new Error("Editor baseline ID does not match the record being saved");
    }
    const db = await this.open();
    this.checkScope();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORD_STORE, "readwrite");
      const store = tx.objectStore(RECORD_STORE);
      const currentRequest = store.get(record.id);
      let preconditionError: Error | null = null;
      currentRequest.onsuccess = () => {
        if (currentStorageScope() !== this.scope) {
          preconditionError = new Error("Account changed before record save committed");
          tx.abort();
          return;
        }
        const existing = currentRequest.result as EventRecord | undefined;
        const matches = expectedSnapshot === null
          ? existing === undefined
          : Boolean(existing && recordContentEqual(normalizeRecord(existing), expectedSnapshot));
        if (!matches) {
          preconditionError = new LocalRevisionChanged(record.id);
          tx.abort();
          return;
        }
        store.put(normalizeRecord(record));
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => {
        db.close();
        reject(preconditionError ?? tx.error ?? new Error("Record save transaction aborted"));
      };
      tx.onerror = () => {
        db.close();
        reject(preconditionError ?? tx.error ?? new Error("Record save transaction failed"));
      };
    });
  }


  /**
   * Portable restore is additive and transactional: old V2/V3 rows are never
   * rewritten, even if another tab edits between the import preview and commit.
   * A collision with DIFFERENT content aborts the complete transaction. No
   * destructive clear/put of the existing archive is allowed.
   */
  async insertMissingAtomic(records: readonly EventRecord[]): Promise<{
    insertedIds: string[]; alreadyPresentIds: string[];
  }> {
    this.checkScope();
    const normalized = records.map(normalizeRecord);
    const ids = new Set(normalized.map(row => row.id));
    if (ids.size !== normalized.length ||
        normalized.some(row => !row.id.trim())) {
      throw new Error("V3_RESTORE_INVALID_RECORD_IDS");
    }
    const db = await this.open();
    this.checkScope();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORD_STORE, "readwrite");
      const store = tx.objectStore(RECORD_STORE);
      const req = store.getAll();
      let cause: Error | null = null;
      const insertedIds: string[] = [];
      const alreadyPresentIds: string[] = [];
      req.onsuccess = () => {
        try {
          this.checkScope();
          const existing = new Map((req.result as EventRecord[]).map(row => [row.id, normalizeRecord(row)]));
          // Check ALL collisions before adding ANY row. A later transaction
          // abort also rolls back every newly inserted row atomically.
          for (const row of normalized) {
            const current = existing.get(row.id);
            if (!current) continue;
            if (JSON.stringify(current) !== JSON.stringify(row)) {
              throw new Error("V3_RESTORE_EXISTING_RECORD_CONFLICT");
            }
            alreadyPresentIds.push(row.id);
          }
          for (const row of normalized) {
            if (existing.has(row.id)) continue;
            store.add(row);
            insertedIds.push(row.id);
          }
        } catch (error) {
          cause = error instanceof Error ? error : new Error("V3_RESTORE_PRECONDITION_FAILED");
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve({ insertedIds, alreadyPresentIds });
      };
      tx.onabort = () => {
        db.close();
        reject(cause ?? tx.error ?? new Error("V3_RESTORE_ATOMIC_TRANSACTION_ABORTED"));
      };
      tx.onerror = () => {
        db.close();
        reject(cause ?? tx.error ?? new Error("V3_RESTORE_ATOMIC_TRANSACTION_FAILED"));
      };
    });
  }

  async applyRemoteIfUnchanged(
    requestSnapshot: EventRecord[],
    remoteResult: EventRecord[],
    options: { includeMedia?: boolean } = {},
  ): Promise<AppliedRemoteBatch> {
    const db = await this.open();
    this.checkScope();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORD_STORE, "readwrite");
      const store = tx.objectStore(RECORD_STORE);
      const req = store.getAll();
      let planned: AppliedRemoteBatch | undefined;

      req.onsuccess = () => {
        // All get/compare/put work occurs in this same live IndexedDB
        // transaction. Do not await a network promise inside this callback.
        if (currentStorageScope() !== this.scope) {
          tx.abort();
          return;
        }
        const rows = (req.result as EventRecord[]).map(normalizeRecord);
        const result = applyRemoteAgainstLive(requestSnapshot, remoteResult, rows, options);
        const accepted = new Set(result.acceptedIds);
        const existing = new Map(rows.map((record) => [record.id, record]));
        for (const candidate of result.records) {
          if (!accepted.has(candidate.id)) continue;
          if (JSON.stringify(existing.get(candidate.id)) !== JSON.stringify(candidate)) {
            store.put(normalizeRecord(candidate));
          }
        }
        planned = result;
      };

      tx.oncomplete = () => {
        db.close();
        if (!planned) {
          reject(new Error("Remote batch finished without a validated write plan"));
          return;
        }
        resolve(planned);
      };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Remote batch transaction aborted")); };
      tx.onerror = () => { db.close(); reject(tx.error ?? new Error("Remote batch transaction failed")); };
    });
  }

  private checkScope(): void {
    if (currentStorageScope() !== this.scope) {
      throw new Error("Account scope changed while preparing a database operation");
    }
  }

  private async open(): Promise<IDBDatabase> {
    this.checkScope();
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(storageScopeKey(DB_BASE_NAME, this.scope), LEGACY_DB_VERSION);
      request.onerror = () => reject(request.error ?? new Error("Scoped IndexedDB unavailable"));
      request.onupgradeneeded = () => {
        // New users receive the same original database format; existing user
        // databases are opened without structural migration.
        const db = request.result;
        if (!db.objectStoreNames.contains(RECORD_STORE)) {
          const store = db.createObjectStore(RECORD_STORE, { keyPath: "id" });
          for (const name of ["date", "city", "category", "status"]) {
            store.createIndex(name, name);
          }
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (currentStorageScope() !== this.scope) {
          db.close();
          reject(new Error("Account switched while opening scoped IndexedDB"));
          return;
        }
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }
}
