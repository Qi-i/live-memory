import type { EventRecord } from "./domain";
import { normalizeRecord } from "./storage";

export interface BackupImportPlan {
  filename: string;
  imported: EventRecord[];
  additions: EventRecord[];
  existingCount: number;
  duplicateCount: number;
  deletedCount: number;
}

export function parseBackupImport(payload: unknown, current: EventRecord[], filename: string): BackupImportPlan {
  const container = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  // Support complete, text-only and legacy array exports. Never accept a
  // single object pretending to be a full collection.
  const rows = Array.isArray(payload) ? payload : container?.records;
  if (!Array.isArray(rows)) throw new Error("备份文件缺少 records 数组，未修改现有档案");
  if (!rows.length) throw new Error("备份文件没有任何记录，未修改现有档案");

  const imported: EventRecord[] = [];
  const seen = new Set<string>();
  for (const [index, item] of rows.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`第 ${index + 1} 条记录格式错误，导入已取消`);
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== "string" || !raw.id.trim() || raw.id.length > 200) {
      throw new Error(`第 ${index + 1} 条记录缺少有效 ID，导入已取消`);
    }
    if (seen.has(raw.id)) throw new Error("备份包含重复记录 ID：" + raw.id.slice(0, 48));
    seen.add(raw.id);
    if (raw.media !== undefined && (!Array.isArray(raw.media) || raw.media.some((media: unknown) => (
      !media || typeof media !== "object" || typeof (media as {src?: unknown}).src !== "string"
    )))) {
      throw new Error(`第 ${index + 1} 条记录的图片数据无效，导入已取消`);
    }
    const normalized = normalizeRecord(raw as unknown as EventRecord);
    imported.push(normalized);
  }

  const currentIds = new Set(current.map((record) => record.id));
  const additions = imported.filter((record) => !currentIds.has(record.id));
  return {
    filename,
    imported,
    additions,
    existingCount: current.length,
    duplicateCount: imported.length - additions.length,
    deletedCount: additions.filter((record) => Boolean(record.deletedAt)).length,
  };
}

export function mergeBackupAdditions(current: EventRecord[], plan: BackupImportPlan): EventRecord[] {
  // Preview can stay open while the app synchronizes in another tab. Recheck
  // the live collection at commit time to avoid overwriting a newly arrived ID.
  const ids = new Set(current.map((record) => record.id));
  return current.concat(plan.additions.filter((record) => !ids.has(record.id)));
}
