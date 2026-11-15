import type { EventRecord } from "../../domain";
import { currentStorageScope } from "../../storage";

const DB = "live-memory-v3-pending-editor-drafts";
const STORE = "pending";
interface PendingRow {
  key: string;
  scope: string;
  draft: EventRecord;
  baseline: EventRecord | null;
  stagedAt: string;
}

/** Separate from the official archive. An unverified/offline edit is a
 * recoverable staged draft, NEVER an acknowledged V3 record or a cloud write.
 * The original media data URLs are retained by IndexedDB for later review.
 */
async function open(scope: string): Promise<IDBDatabase> {
  if (!scope || currentStorageScope() !== scope)
    throw Error("V3_PENDING_SCOPE_CHANGED");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onerror = () => reject(request.error ?? Error("V3_PENDING_DB_UNAVAILABLE"));
    request.onsuccess = () => {
      if (currentStorageScope() !== scope) {
        request.result.close(); reject(Error("V3_PENDING_SCOPE_CHANGED")); return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
async function transaction<T>(scope:string,mode:IDBTransactionMode,
  command:(store:IDBObjectStore,done:(value:T)=>void)=>void):Promise<T>{
  const db=await open(scope);
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode);
    let result:T;
    let problem:unknown;
    tx.oncomplete=()=>{db.close();
      currentStorageScope()===scope ? resolve(result) :
        reject(Error("V3_PENDING_SCOPE_CHANGED"));};
    tx.onabort=()=>{db.close();reject(problem??tx.error??Error("V3_PENDING_TX_ABORT"));};
    tx.onerror=()=>{problem=tx.error;};
    try{command(tx.objectStore(STORE),value=>{result=value;});}
    catch(error){problem=error;tx.abort();}
  });
}
export type PendingEditorRow = Omit<PendingRow,"key">;
export async function stagePendingEditor(scope:string,draft:EventRecord,
  baseline:EventRecord|null):Promise<void>{
  if (!draft.id || !draft.title.trim() || draft.schemaVersion !== 2)
    throw Error("V3_PENDING_INVALID_DRAFT");
  const key=scope+":"+draft.id;
  await transaction<void>(scope,"readwrite",(store,done)=>{
    store.put({key,scope,draft,baseline,stagedAt:new Date().toISOString()} satisfies PendingRow);
    done(undefined);
  });
}
export async function listPendingEditors(scope:string):Promise<PendingEditorRow[]>{
  return transaction<PendingEditorRow[]>(scope,"readonly",(store,done)=>{
    const request=store.getAll();
    request.onsuccess=()=>done((request.result as PendingRow[])
      .filter(row=>row.scope===scope)
      .map(({scope,draft,baseline,stagedAt})=>({scope,draft,baseline,stagedAt}))
      .sort((a,b)=>b.stagedAt.localeCompare(a.stagedAt)));
    request.onerror=()=>{throw request.error;};
  });
}
export async function removePendingEditor(scope:string,id:string):Promise<void>{
  await transaction<void>(scope,"readwrite",(store,done)=>{
    store.delete(scope+":"+id);done(undefined);
  });
}
