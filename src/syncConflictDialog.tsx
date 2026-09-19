import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppSettings, EventRecord } from "./domain";
import type { SyncConflict } from "./supabase";
import { resolveAllConflicts, resolveSyncConflict } from "./supabase";

function formatConflictTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const base = date.toLocaleString("zh-CN");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return date.getMilliseconds() ? `${base}.${ms}` : base;
}

export function SyncConflictDialog({
  conflicts,
  settings,
  onResolve,
  onDismiss,
}: {
  conflicts: SyncConflict[];
  settings: AppSettings;
  onResolve: (resolved: EventRecord[]) => Promise<void>;
  onDismiss: () => void;
}) {
  const [remaining, setRemaining] = useState(conflicts);
  const [resolved, setResolved] = useState<EventRecord[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRemaining(conflicts);
    setResolved([]);
    setError("");
  }, [conflicts]);

  async function resolveOne(conflict: SyncConflict, choice: "local" | "cloud") {
    setWorking(true);
    setError("");
    try {
      const record = await resolveSyncConflict(settings, conflict, choice);
      const nextRemaining = remaining.filter((item) => item.recordId !== conflict.recordId || item.source !== conflict.source);
      const nextResolved = resolved.filter((item) => item.id !== record.id).concat(record);
      setRemaining(nextRemaining);
      setResolved(nextResolved);
      if (!nextRemaining.length) await onResolve(nextResolved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "冲突处理失败");
    } finally {
      setWorking(false);
    }
  }

  async function resolveAll(choice: "local" | "cloud") {
    setWorking(true);
    setError("");
    try {
      const next = await resolveAllConflicts(settings, remaining, choice);
      const merged = new Map(resolved.map((record) => [record.id, record]));
      next.forEach((record) => merged.set(record.id, record));
      setRemaining([]);
      await onResolve(Array.from(merged.values()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "批量处理失败");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="dialog-backdrop-v2" onClick={onDismiss}>
      <section className="conflict-dialog-v2" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header>
          <span>SYNC CONFLICT</span>
          <h2>{remaining.length} 条记录同时被修改</h2>
          <p>逐条选择本地或云端版本。已经处理的选择会暂存到全部完成后一次写回，不会丢失前面的结果。</p>
        </header>
        {error && <p className="conflict-error-v2">{error}</p>}
        {remaining.length > 1 && (
          <div className="conflict-bulk-v2">
            <button className="button ghost" disabled={working} type="button" onClick={() => void resolveAll("local")}>全部保留本地</button>
            <button className="button ghost" disabled={working} type="button" onClick={() => void resolveAll("cloud")}>全部保留云端</button>
          </div>
        )}
        <div>
          {remaining.map((conflict) => (
            <article key={`${conflict.source}:${conflict.recordId}`}>
              <div className="conflict-record-copy-v2">
                <strong>{conflict.title}</strong>
                <span>实际差异：{conflict.diffFields.length ? conflict.diffFields.join("、") : "记录内容"}</span>
                {conflict.localUpdatedAt === conflict.cloudUpdatedAt
                  ? <small>两个版本时间戳完全一致，无法用时间判断来源；仅在内容确实不同时才需要选择。</small>
                  : null}
              </div>
              <p>本地：{formatConflictTime(conflict.localUpdatedAt)}<br />云端：{formatConflictTime(conflict.cloudUpdatedAt)}</p>
              <div className="conflict-actions-v2">
                <button className="button primary" disabled={working} type="button" onClick={() => void resolveOne(conflict, "local")}>保留本地</button>
                <button className="button ghost" disabled={working} type="button" onClick={() => void resolveOne(conflict, "cloud")}>保留云端</button>
              </div>
            </article>
          ))}
        </div>
        <footer>
          <span>{working && <Loader2 className="spin" />} 已完成 {resolved.length} 条</span>
          <button className="button ghost" type="button" disabled={working} onClick={onDismiss}>稍后处理</button>
        </footer>
      </section>
    </div>
  );
}
