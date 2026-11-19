import { createV3SyncRuntime } from "./createV3SyncRuntime";
import { currentStorageScope, readSettings } from "../storage";

/** Existing signed-in V3 account, double-verified by the original V3 adapter.
 * A QiHub host receives only records and CAS server revisions. The private
 * media objects themselves are not yet transferred, and no auth credential,
 * signed Storage URL, or local IndexedDB-only record leaves this origin.
 */
export async function collectQiHubReadOnlySnapshot() {
  const accountId = currentStorageScope();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(accountId)) {
    throw Error("QIHUB_SOURCE_SIGN_IN_REQUIRED");
  }
  const runtime = await createV3SyncRuntime(readSettings(), "secure-account");
  const rows = await runtime.readAuthenticatedV3ManifestForQiHub();
  if (currentStorageScope() !== accountId) {
    throw Error("QIHUB_V3_ACCOUNT_CHANGED");
  }
  const events = rows.map(({ record, serverRevision }) => ({
    id: record.id,
    serverRevision: Number(serverRevision),
    record: {
      ...record,
      // Raw cloud metadata contains paths and historical external links.
      // Never send a generated/private signed URL or original image bytes.
      media: record.media.map(asset => ({ ...asset, src: "" })),
    },
  }));
  return {
    format: "qihub-native-source-snapshot-v1" as const,
    project: "memory" as const,
    accountId,
    source: "supabase-v3-secure-account" as const,
    capturedAt: new Date().toISOString(),
    complete: true as const,
    collections: { events },
  };
}
