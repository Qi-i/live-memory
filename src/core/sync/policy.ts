/**
 * Explicit three-way decisions. A timestamp is diagnostic metadata, not a
 * conflict detector. Only different changes since the same acknowledged cloud
 * revision can produce an actual concurrent-edit conflict.
 */
export type RecordSyncAction =
  | "unchanged"
  | "push-new"
  | "pull-new"
  | "push"
  | "pull"
  | "conflict"
  | "unbased-divergence";

export interface RecordSyncInput {
  localRevision?: string;
  remoteRevision?: string;
  /** Last successfully acknowledged *remote* revision for this scope/provider/id. */
  acknowledgedRevision?: string;
}

export interface RecordSyncDecision {
  action: RecordSyncAction;
  needsUserReview: boolean;
  reason: string;
}

export function decideRecordSync({
  localRevision: local,
  remoteRevision: remote,
  acknowledgedRevision: base,
}: RecordSyncInput): RecordSyncDecision {
  if (!local && !remote) return { action: "unchanged", needsUserReview: false, reason: "no-record" };
  if (local && !remote) return { action: "push-new", needsUserReview: false, reason: "missing-on-remote" };
  if (!local && remote) return { action: "pull-new", needsUserReview: false, reason: "missing-on-device" };
  if (local === remote) return { action: "unchanged", needsUserReview: false, reason: "semantically-identical" };

  // An old installation may lack version history. Never label a simple
  // timestamp mismatch a concurrent edit, or silently destroy either copy.
  if (!base) return { action: "unbased-divergence", needsUserReview: true, reason: "baseline-migration-required" };

  const changedHere = local !== base;
  const changedThere = remote !== base;
  if (changedHere && !changedThere) {
    return { action: "push", needsUserReview: false, reason: "local-only-change" };
  }
  if (!changedHere && changedThere) {
    return { action: "pull", needsUserReview: false, reason: "remote-only-change" };
  }
  if (changedHere && changedThere) {
    return { action: "conflict", needsUserReview: true, reason: "independent-changes-since-common-base" };
  }
  // Defensive fallback: equality is handled first.
  return { action: "unchanged", needsUserReview: false, reason: "matched-base" };
}

export type SyncActivity =
  | { type: "idle" | "checking" | "connected" }
  | { type: "transferred"; direction: "push" | "pull"; changedRecords: number }
  | { type: "conflict"; count: number }
  | { type: "offline" | "error"; message: string };

export type SyncPresentation = {
  surface: "silent" | "status-center" | "attention";
  label: string;
};

/** Normal reconnects and repeated checks never move the archive layout. */
export function presentSyncActivity(activity: SyncActivity): SyncPresentation {
  switch (activity.type) {
    case "idle": return { surface: "silent", label: "已保存" };
    case "checking": return { surface: "status-center", label: "正在检查更新" };
    case "connected": return { surface: "silent", label: "云端连接正常" };
    case "transferred":
      return activity.changedRecords > 0
        ? { surface: "status-center", label: activity.direction === "pull" ? "已合并其他设备更新" : "已同步本机修改" }
        : { surface: "silent", label: "已是最新" };
    case "conflict":
      return activity.count > 0
        ? { surface: "attention", label: activity.count + " 条真正的并发修改需要处理" }
        : { surface: "silent", label: "没有同步冲突" };
    case "offline": return { surface: "status-center", label: activity.message };
    case "error": return { surface: "attention", label: activity.message };
  }
}
