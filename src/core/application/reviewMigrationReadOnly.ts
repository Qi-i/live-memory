import type { EventRecord } from "../../domain";
import type { RecordRepository } from "../ports/RecordRepository";
import type { CloudRecordAdapter } from "../ports/CloudRecordAdapter";
import type { RevisionBaselineStore } from "../sync/baselines";
import { canonicalRecord, recordRevision, stableSerialize } from "../sync/revision";
import { decideRecordSync, type RecordSyncAction } from "../sync/policy";

/** Private in-browser inspection, never a public analytics or server log. */
export interface MigrationReviewItem {
  id: string;
  title: string;
  action: Exclude<RecordSyncAction, "unchanged">;
  localPresent: boolean;
  remotePresent: boolean;
  /** Field NAMES only: never serialized field contents or media bytes. */
  differingFields: string[];
}
export interface MigrationReview {
  total: number;
  displayed: number;
  truncated: boolean;
  items: MigrationReviewItem[];
}

const MAX_ITEMS = 100;

function indexRecords<T>(records: T[], identify: (row: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of records) {
    const id = identify(item);
    if (!id || result.has(id)) throw new Error("V3_REVIEW_INVALID_INVENTORY");
    result.set(id, item);
  }
  return result;
}

function differenceNames(local: EventRecord, remote: EventRecord, media: boolean): string[] {
  const a = canonicalRecord(local, media) as Record<string, unknown>;
  const b = canonicalRecord(remote, media) as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return fields
    .filter((field) => stableSerialize(a[field]) !== stableSerialize(b[field]))
    .slice(0, 16);
}

/** Read only: display which old records require review, without selecting a winner. */
export async function reviewMigrationReadOnly(
  local: Pick<RecordRepository, "scope" | "list">,
  cloud: Pick<CloudRecordAdapter, "provider" | "identity" | "accountScope" | "includeMedia" | "list">,
  baseline: Pick<RevisionBaselineStore, "read">,
): Promise<MigrationReview> {
  if (!local.scope || cloud.accountScope !== local.scope || !cloud.identity.trim()) {
    throw new Error("V3 migration review identity mismatch");
  }
  const [locals, cloudRows] = await Promise.all([local.list(), cloud.list()]);
  const device = indexRecords(locals, (row) => row.id);
  const remote = indexRecords(cloudRows, (row) => row.record.id);
  const allIds = [...new Set([...device.keys(), ...remote.keys()])].sort();
  const items: MigrationReviewItem[] = [];
  let total = 0;
  for (const id of allIds) {
    const here = device.get(id);
    const there = remote.get(id)?.record;
    const decision = decideRecordSync({
      localRevision: here ? await recordRevision(here, cloud.includeMedia) : undefined,
      remoteRevision: there ? await recordRevision(there, cloud.includeMedia) : undefined,
      acknowledgedRevision: baseline.read(id),
    });
    if (decision.action === "unchanged") continue;
    total += 1;
    if (items.length >= MAX_ITEMS) continue;
    const title = (here?.title || there?.title || "未命名记录").trim().slice(0, 160) || "未命名记录";
    items.push({
      id,
      title,
      action: decision.action,
      localPresent: Boolean(here),
      remotePresent: Boolean(there),
      differingFields: here && there ? differenceNames(here, there, cloud.includeMedia) : [],
    });
  }
  return { total, displayed: items.length, truncated: total > items.length, items };
}
