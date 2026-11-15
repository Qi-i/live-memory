import type { EventRecord } from "../../domain";
import { currentStorageScope } from "../../storage";

const DATABASE = "live-memory-v3-conflict-vault";
const STORE = "protected-versions";

export interface ProtectedConflictSummary {
  key: string;
  recordId: string;
  savedSide: "local" | "cloud";
  title: string;
  savedAt: string;
  assets: number;
}

export interface ProtectedConflictVersion {
  key: string;
  scope: string;
  recordId: string;
  savedSide: "local" | "cloud";
  record: EventRecord;
  savedAt: string;
  /** Full media bytes are stored separately from URLs, including signed URLs. */
  assets: Array<{ id: string; bytes: Blob }>;
}

function assertScope(scope: string): void {
  if (!scope || currentStorageScope() !== scope) {
    throw new Error("V3_CONFLICT_VAULT_SCOPE_CHANGED");
  }
}

async function open(scope: string): Promise<IDBDatabase> {
  assertScope(scope);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onerror = () => reject(req.error ?? Error("V3_CONFLICT_VAULT_OPEN_FAILED"));
    req.onsuccess = () => {
      if (currentStorageScope() !== scope) {
        req.result.close();
        reject(Error("V3_CONFLICT_VAULT_SCOPE_CHANGED"));
        return;
      }
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
  });
}

function readOrWrite<T>(scope: string, mode: IDBTransactionMode,
  act: (store: IDBObjectStore, commit: (value: T) => void) => void,
): Promise<T> {
  return open(scope).then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let output: T;
    let failure: Error | null = null;
    tx.oncomplete = () => {
      db.close();
      if (currentStorageScope() !== scope) reject(Error("V3_CONFLICT_VAULT_SCOPE_CHANGED"));
      else resolve(output);
    };
    tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? Error("V3_CONFLICT_VAULT_TRANSACTION_FAILED")); };
    tx.onerror = () => { failure = tx.error ?? Error("V3_CONFLICT_VAULT_TRANSACTION_FAILED"); };
    try { act(tx.objectStore(STORE), value => { output = value; }); }
    catch (error) {
      failure = error instanceof Error ? error : Error("V3_CONFLICT_VAULT_TRANSACTION_FAILED");
      tx.abort();
    }
  }));
}

/** This happens BEFORE either conflicting business version may be replaced.
 * A missing original, invalid byte stream or quota exhaustion blocks the
 * resolution. Never claim a metadata-only signed URL is a safe backup.
 */
export async function protectConflictVersion(
  scope: string, record: EventRecord, savedSide: "local" | "cloud",
  resolveOriginal: (asset: EventRecord["media"][number]) => Promise<string>,
): Promise<string> {
  assertScope(scope);
  const assets: ProtectedConflictVersion["assets"] = [];
  for (const asset of record.media) {
    assertScope(scope);
    const source = await resolveOriginal(asset);
    assertScope(scope);
    if (!source) throw Error("V3_CONFLICT_ORIGINAL_MISSING");
    const response = await fetch(source, { credentials: "omit" });
    if (!response.ok || response.type === "opaque") throw Error("V3_CONFLICT_ORIGINAL_MISSING");
    const bytes = await response.blob();
    assertScope(scope);
    if (!bytes.size || bytes.size > 32 * 1024 * 1024) {
      throw Error("V3_CONFLICT_ORIGINAL_INVALID");
    }
    assets.push({ id: asset.id, bytes });
  }
  const key = scope + ":" + crypto.randomUUID();
  const row: ProtectedConflictVersion = {
    key, scope, recordId: record.id, savedSide, record,
    savedAt: new Date().toISOString(), assets,
  };
  await readOrWrite<void>(scope, "readwrite", (store, commit) => {
    store.add(row);
    commit(undefined);
  });
  return key;
}

export async function listProtectedConflictVersions(scope: string): Promise<ProtectedConflictSummary[]> {
  assertScope(scope);
  return readOrWrite(scope, "readonly", (store, commit) => {
    const req = store.getAll();
    req.onsuccess = () => commit((req.result as ProtectedConflictVersion[])
      .filter(item => item.scope === scope)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .map(item => ({
        key: item.key, recordId: item.recordId, savedSide: item.savedSide,
        title: item.record.title, savedAt: item.savedAt, assets: item.assets.length,
      })));
  });
}

/** Restore only as an account-scoped pending edit; never silently overwrite
 * the formal record or a different cloud version. The caller must choose
 * the next action explicitly after checking this protected copy.
 */
export async function readProtectedConflictVersion(
  scope: string, key: string,
): Promise<ProtectedConflictVersion | null> {
  assertScope(scope);
  if (!key.startsWith(scope + ":")) throw Error("V3_CONFLICT_VAULT_SCOPE_CHANGED");
  return readOrWrite(scope, "readonly", (store, commit) => {
    const req = store.get(key);
    req.onsuccess = () => commit((req.result as ProtectedConflictVersion | undefined) ?? null);
  });
}
