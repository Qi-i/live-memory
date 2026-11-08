import type { EventRecord } from "../../domain";
import { currentStorageScope, normalizeRecord, storageScopeKey } from "../../storage";
import type { RecordRepository, AppliedRemoteBatch } from "../../core/ports/RecordRepository";
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
      req.onsuccess = () => resolve(
        (req.result as EventRecord[]).map(normalizeRecord).sort((a, b) => b.date.localeCompare(a.date)),
      );
      req.onerror = () => reject(req.error ?? new Error("Unable to load scoped records"));
      tx.onabort = () => reject(tx.error ?? new Error("Record read aborted"));
    });
  }

  async upsert(record: EventRecord): Promise<void> {
    const db = await this.open();
    this.checkScope();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORD_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Record write aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("Record write failed"));
      // The transaction has been opened after the scope assertion. Even if
      // navigation changes scopes meanwhile, its store is tied to the old DB.
      tx.objectStore(RECORD_STORE).put(normalizeRecord(record));
    });
  }

  async applyRemoteIfUnchanged(
    requestSnapshot: EventRecord[],
    remoteResult: EventRecord[],
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
        const result = applyRemoteAgainstLive(requestSnapshot, remoteResult, rows);
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
        if (!planned) {
          reject(new Error("Remote batch finished without a validated write plan"));
          return;
        }
        resolve(planned);
      };
      req.onerror = () => reject(req.error ?? new Error("Unable to read current record revisions"));
      tx.onabort = () => reject(tx.error ?? new Error("Remote batch transaction aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("Remote batch transaction failed"));
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
