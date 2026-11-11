import type { PrivateMirrorImportPlan } from "./planPrivateMirrorImport";

/**
 * Bound, single-use user confirmation for an account-private backup mirror.
 * A matching filename, count or mtime cannot authorize a different file.
 * The full backup SHA-256 is computed from the exact bytes at each click.
 */
export function mirrorApprovalFingerprint(
  fileSha256: string,
  plan: Pick<PrivateMirrorImportPlan,
    "userId" | "records" | "assets" | "bytes" | "alreadyPresent" | "toCreate">,
): string {
  if (!/^[a-f0-9]{64}$/.test(fileSha256) ||
      !/^[a-f0-9-]{36}$/.test(plan.userId) ||
      [plan.records,plan.assets,plan.bytes,plan.alreadyPresent].some(
        value => !Number.isSafeInteger(value) || value < 0,
      ) || !Array.isArray(plan.toCreate)) {
    throw Error("V3_MIRROR_APPROVAL_INVALID");
  }
  const ids=plan.toCreate.map(row=>row.id).sort();
  if(ids.some(id=>typeof id!=="string" || !id.trim()) ||
     new Set(ids).size!==ids.length ||
     ids.length+plan.alreadyPresent!==plan.records) {
    throw Error("V3_MIRROR_APPROVAL_INVALID");
  }
  return JSON.stringify([
    fileSha256,plan.userId,plan.records,plan.assets,plan.bytes,
    plan.alreadyPresent,ids,
  ]);
}

export function verifyMirrorApproval(
  approved: string,
  actual: string,
): void {
  if (!approved || approved!==actual)
    throw Error("V3_MIRROR_APPROVED_FILE_OR_REMOTE_PLAN_CHANGED");
}
