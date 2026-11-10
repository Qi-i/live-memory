export interface SecureCutoverReadiness {
  mode: "v2" | "v3";
  legacyRecords: number;
  mirrorRecords: number;
  missingLegacy: number;
  hasApproval: boolean;
  backupApproved: boolean;
  mediaApproved: boolean;
  sourcesApproved: boolean;
  snapshotsMatch: boolean;
  ready: boolean;
  reasons: string[];
}

interface ReadinessRow {
  legacy_digest: string; mirror_digest: string;
  legacy_count: number; mirror_count: number;
  missing_legacy_count: number;
}
interface ApprovalRow {
  legacy_digest: string; mirror_digest: string;
  full_backup_verified: boolean; media_bytes_verified: boolean;
  personal_sources_verified: boolean;
}

function count(v: unknown): number {
  if ((typeof v !== "number" && typeof v !== "string") ||
      !Number.isSafeInteger(Number(v)) || Number(v) < 0) {
    throw Error("V3_CUTOVER_INVALID_SERVER_COUNTS");
  }
  return Number(v);
}
function digest(v: unknown): v is string {
  return typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
}

/** Pure result classifier. Never returns any private record bodies, owner key,
 * ticket contents, signed Storage links or account identifying information.
 * Readiness is diagnostic: it is NOT permission to call activation. */
export function classifySecureCutoverReadiness(
  input: ReadinessRow,approval: ApprovalRow|null,mode: "v2"|"v3",
):SecureCutoverReadiness {
  if (mode!=="v2" && mode!=="v3" || !input ||
      !digest(input.legacy_digest)||!digest(input.mirror_digest)){
    throw Error("V3_CUTOVER_INVALID_SERVER_RESPONSE");
  }
  const legacyRecords=count(input.legacy_count);
  const mirrorRecords=count(input.mirror_count);
  const missingLegacy=count(input.missing_legacy_count);
  if (missingLegacy>legacyRecords)throw Error("V3_CUTOVER_INVALID_SERVER_COUNTS");
  const hasApproval=!!approval;
  if(approval && (!digest(approval.legacy_digest)||
                  !digest(approval.mirror_digest))){
    throw Error("V3_CUTOVER_INVALID_APPROVAL");
  }
  const snapshotsMatch=!!approval &&
    approval.legacy_digest===input.legacy_digest &&
    approval.mirror_digest===input.mirror_digest;
  const backupApproved=approval?.full_backup_verified===true;
  const mediaApproved=approval?.media_bytes_verified===true;
  const sourcesApproved=approval?.personal_sources_verified===true;
  const reasons:string[]=[];
  if(mirrorRecords===0)reasons.push("账号私有完整档案尚未导入");
  if(missingLegacy>0)reasons.push("仍有 "+missingLegacy+" 条旧账号记录未进入私有镜像");
  if(!hasApproval)reasons.push("缺少独立迁移验收记录");
  if(!backupApproved)reasons.push("可恢复的全量备份尚未获验收");
  if(!mediaApproved)reasons.push("原图字节及私有副本尚未获验收");
  if(!sourcesApproved)reasons.push("旧个人云来源归属尚未获验收");
  if(hasApproval&&!snapshotsMatch)reasons.push("旧版或新镜像数据在验收后发生变化");
  if(mode==="v3"&&reasons.length)reasons.push("写入模式与迁移条件不一致，需停止操作并复核");
  return {
    mode,legacyRecords,mirrorRecords,missingLegacy,hasApproval,
    backupApproved,mediaApproved,sourcesApproved,snapshotsMatch,
    ready:reasons.length===0,reasons,
  };
}
