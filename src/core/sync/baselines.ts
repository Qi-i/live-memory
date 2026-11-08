/**
 * Persistent per-account, per-provider acknowledged cloud revisions.
 * Store only SHA-256 digests: never a private note, ticket, poster data URL,
 * owner key, or account token. This is bookkeeping, NOT a content backup.
 */

export interface BaselineStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RevisionEntry {
  id: string;
  revision: string;
}

interface BaselineDocument {
  schema: 1;
  entries: Record<string, string>;
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export async function createBaselineKey(
  accountScope: string,
  provider: "personal" | "account",
  providerIdentity: string,
): Promise<string> {
  if (!accountScope.trim() || !providerIdentity.trim()) {
    throw new Error("A known account and cloud identity are required for sync baselines");
  }
  const input = new TextEncoder().encode(JSON.stringify({ accountScope, provider, providerIdentity }));
  const digest = await crypto.subtle.digest("SHA-256", input);
  const suffix = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  // No credentials or cloud URL are included in the readable localStorage key.
  return "live-memory:sync-base:v3:" + suffix;
}

export class RevisionBaselineStore {
  constructor(private readonly storage: BaselineStorage, private readonly key: string) {}

  read(id: string): string | undefined {
    return this.parse().entries[id];
  }

  acknowledge(items: RevisionEntry[]): void {
    const next = this.parse();
    for (const item of items) {
      if (!item.id.trim() || !DIGEST_PATTERN.test(item.revision)) {
        throw new Error("Invalid acknowledged revision; cloud baseline was not advanced");
      }
      next.entries[item.id] = item.revision;
    }
    this.storage.setItem(this.key, JSON.stringify(next));
  }

  forget(ids: string[]): void {
    const next = this.parse();
    for (const id of ids) delete next.entries[id];
    this.storage.setItem(this.key, JSON.stringify(next));
  }

  private parse(): BaselineDocument {
    const raw = this.storage.getItem(this.key);
    if (!raw) return { schema: 1, entries: {} };
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error("Sync baseline metadata is corrupted; do not overwrite cloud records"); }
    if (
      !parsed || typeof parsed !== "object" ||
      (parsed as { schema?: unknown }).schema !== 1 ||
      !(parsed as { entries?: unknown }).entries ||
      typeof (parsed as { entries?: unknown }).entries !== "object" ||
      Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      throw new Error("Unknown sync baseline version; migration is required");
    }
    const entries = (parsed as BaselineDocument).entries;
    if (Object.values(entries).some((revision) => !DIGEST_PATTERN.test(revision))) {
      throw new Error("Invalid sync baseline digest; do not overwrite cloud records");
    }
    return { schema: 1, entries: { ...entries } };
  }
}
