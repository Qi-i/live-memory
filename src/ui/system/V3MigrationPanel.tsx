import { useEffect, useMemo, useRef, useState } from "react";
import { currentStorageScope } from "../../storage";
import type { AppSettings, EventRecord } from "../../domain";
import { auditBackupPortability } from "../../core/application/auditBackupPortability";
import type { ReadOnlySyncAudit } from "../../core/application/auditSyncReadOnly";
import type { BaselineBootstrapReport } from "../../core/application/bootstrapEquivalentBaselines";
import type { MigrationReview, MigrationReviewItem } from "../../core/application/reviewMigrationReadOnly";
import "./v3MigrationPanel.css";

type Provider = "account" | "personal";
const REVIEW_LABELS: Record<MigrationReviewItem["action"], string> = {
  "push-new": "仅本机", "pull-new": "仅云端",
  "push": "本机单端更新", "pull": "云端单端更新",
  "conflict": "双端并发修改", "unbased-divergence": "历史基线未知",
  "defer-absence": "缺失待核实",
};
interface ProviderState {
  audit: ReadOnlySyncAudit;
  bootstrap?: BaselineBootstrapReport;
  review?: MigrationReview;
}
interface Props {
  settings: AppSettings;
  records: EventRecord[];
  personalConnected: boolean;
}

/**
 * V3 migration diagnostics on the real, authenticated account:
 * deliberately NO autosync, record transfers, edits, media uploads or cloud
 * mutations. Only user-invoked, identical-content baseline metadata adoption.
 * The V2 app remains authoritative until the complete cutover gate passes.
 */
export function V3MigrationPanel({ settings, records, personalConnected }: Props) {
  const backupAudit = useMemo(() => auditBackupPortability(records), [records]);
  const [states, setStates] = useState<Partial<Record<Provider, ProviderState>>>({});
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState("");
  const scopeGeneration = useRef(0);
  const backupInFlight = useRef<number | null>(null);
  const backupJobCounter = useRef(0);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState("");
  useEffect(() => {
    // Never display results obtained for an earlier account/cloud configuration.
    scopeGeneration.current += 1;
    backupInFlight.current = null;
    setBackupBusy(false);
    setStates({});
    setPending(null);
    setError("");
    setBackupStatus("");
    return () => { scopeGeneration.current += 1; };
  }, [settings.supabase.url, settings.supabase.ownerKey]);

  async function inspect(provider: Provider, bootstrap = false, details = false) {
    if (pending || backupInFlight.current !== null) return;
    const requestGeneration = scopeGeneration.current;
    const requestScope = currentStorageScope();
    setPending(provider);
    setError("");
    try {
      // Dynamic import keeps the authenticated V3 runtime out of the demo-only
      // preview dependency graph. Nothing connects without a user click.
      const { createV3SyncRuntime } = await import("../../infrastructure/createV3SyncRuntime");
      const runtime = await createV3SyncRuntime(settings, provider);
      const baseline = bootstrap ? await runtime.bootstrapMatchingHistory() : undefined;
      const review = details ? await runtime.review() : undefined;
      const audit = await runtime.audit();
      if (scopeGeneration.current !== requestGeneration || currentStorageScope() !== requestScope) return;
      setStates((current) => ({
        ...current,
        [provider]: { audit, bootstrap: baseline ?? current[provider]?.bootstrap,
          review: review ?? current[provider]?.review },
      }));
    } catch (failure) {
      if (scopeGeneration.current !== requestGeneration || currentStorageScope() !== requestScope) return;
      const code = failure instanceof Error ? failure.message : "";
      setError(code.includes("V3_REMOTE_INVENTORY_CHANGED")
        ? "云端正在变化，已取消本次检查；稍后可重新执行，不会丢失档案。"
        : "检查未完成。请核实当前账号、云端连接及浏览器本机存储状态；没有改动任何档案。");
    } finally {
      if (scopeGeneration.current === requestGeneration && currentStorageScope() === requestScope) setPending(null);
    }
  }

  /** Explicit read-only export; all media bytes must be verifiably portable. */
  async function exportVerifiedPortableBackup() {
    if (backupInFlight.current !== null || pending) return;
    const backupJob = ++backupJobCounter.current;
    backupInFlight.current = backupJob;
    const scope = currentStorageScope();
    const generation = scopeGeneration.current;
    const assertScope = () => {
      if (scopeGeneration.current !== generation || currentStorageScope() !== scope) {
        throw new Error("V3_BACKUP_ACCOUNT_CHANGED");
      }
    };
    setBackupBusy(true);
    setBackupStatus("");
    try {
      const [
        { listRecords },
        { resolveMediaSource },
        { readAsDataUrl, downloadBlob },
        { createPortableBackup, verifyPortableBackupDocument },
        { completeBackupInventory, verifyBackupCloudUnchanged },
        { stableSerialize },
      ] = await Promise.all([
        import("../../storage"),
        import("../../mediaCache"),
        import("../../media"),
        import("../../core/application/portableMediaBackup"),
        import("../../core/application/completeBackupInventory"),
        import("../../core/sync/revision"),
      ]);
      assertScope();
      const original = await listRecords();
      assertScope();
      // The historic backup exported ONLY IndexedDB rows, silently omitting
      // records on other devices. Read the entire personal cloud snapshot if
      // connected and reconcile the two inventories without choosing winners.
      const cloudRuntime = personalConnected
        ? await (await import("../../infrastructure/createV3SyncRuntime"))
            .createV3SyncRuntime(settings, "personal")
        : null;
      assertScope();
      const remoteBefore = cloudRuntime
        ? await cloudRuntime.readPersonalCloudForPortableBackup()
        : [];
      assertScope();
      if (!original.length && !remoteBefore.length) throw new Error("V3_BACKUP_EMPTY_ARCHIVE");
      const inventory = cloudRuntime
        ? completeBackupInventory(original, remoteBefore)
        : { records: original, counts: {
            local: original.length, remote: 0, shared: 0,
            localOnly: original.length, remoteOnly: 0, total: original.length,
          } };
      const backup = await createPortableBackup(inventory.records, {
        assertScope,
        async load(asset) {
          assertScope();
          const source = await resolveMediaSource(asset, true);
          assertScope();
          if (!source) throw new Error("V3_BACKUP_MEDIA_UNAVAILABLE");
          const response = await fetch(source, { mode: "cors", credentials: "omit" });
          if (!response.ok || response.type === "opaque") {
            throw new Error("V3_BACKUP_MEDIA_UNAVAILABLE");
          }
          return response.blob();
        },
        encode: readAsDataUrl,
      });
      assertScope();
      const checked = await verifyPortableBackupDocument(backup);
      assertScope();
      // A backup based on stale local state cannot be called complete. Check
      // even inline media bytes (not just timestamps or storage paths).
      const current = await listRecords();
      const originals = new Map(original.map((row) => [row.id, stableSerialize(row)]));
      if (originals.size !== original.length || current.length !== original.length ||
          current.some((row) => originals.get(row.id) !== stableSerialize(row))) {
        throw new Error("V3_BACKUP_LOCAL_CHANGED");
      }
      // A multi-minute image export can race other devices. Re-list through
      // the same authenticated cloud scope; no changed revision or missing
      // record is allowed to receive a "complete" backup certificate.
      if (cloudRuntime) {
        const remoteAfter = await cloudRuntime.readPersonalCloudForPortableBackup();
        assertScope();
        verifyBackupCloudUnchanged(remoteBefore, remoteAfter);
      }
      assertScope();
      downloadBlob(JSON.stringify(backup),
        `live-memory-v3-${cloudRuntime ? "complete" : "local-only"}-${new Date().toISOString().slice(0, 10)}.json`,
        "application/json");
      setBackupStatus(cloudRuntime
        ? `已提交完整备份下载：${checked.records} 条记录、${checked.assets} 个媒体文件；
          本机独有 ${inventory.counts.localOnly} 条、云端独有 ${inventory.counts.remoteOnly} 条。
          请验证下载文件并独立保存；本次未修改任何云端或本机数据。`
        : `已提交仅本机备份下载：${checked.records} 条记录、${checked.assets} 个媒体文件。
          未连接个人云，此文件不包含其他设备的云端独有档案，不能作为完整切换依据。`);
    } catch (failure) {
      if (scopeGeneration.current === generation && currentStorageScope() === scope) {
        const reason = failure instanceof Error ? failure.message : "";
        setBackupStatus(reason.includes("V3_COMPLETE_BACKUP_DIVERGENT_RECORDS")
          ? "未导出：本机与个人云有同 ID 但内容不同的记录。必须在差异明细中人工核对；不会替您覆盖或丢弃任一版本。"
          : reason.includes("V3_COMPLETE_BACKUP_CLOUD_CHANGED") || reason.includes("V3_REMOTE_INVENTORY_CHANGED")
            ? "未导出：其他设备正在修改云端记录，需在数据稳定后重新生成完整备份。"
            : "备份未生成：个人云不可用、图片字节无法读取、数据变化或文件超过安全容量上限。没有修改本机或云端档案。");
      }
    } finally {
      if (backupInFlight.current === backupJob) {
        backupInFlight.current = null;
        if (scopeGeneration.current === generation && currentStorageScope() === scope) setBackupBusy(false);
      }
    }
  }

  return (
    <section className="settings-module v3-migration-panel" aria-label="V3 数据迁移诊断">
      <header className="v3-migration-head">
        <div>
          <span>V3 · 兼容迁移</span>
          <h3>旧档案一致性检查</h3>
          <p>检查现有 V2 数据与 V3 同步基线，不启用 V3 自动同步，不覆盖记录或图片。</p>
        </div>
        <strong>仅测试通道</strong>
      </header>
      <div className="v3-migration-grid">
        {(["account", "personal"] as Provider[]).map((provider) => {
          const enabled = provider === "account" || personalConnected;
          const state = states[provider];
          const label = provider === "account" ? "账号文字备份" : "个人完整云端";
          return (
            <div className="v3-migration-provider" key={provider}>
              <div className="v3-migration-title">
                <strong>{label}</strong>
                <span>{enabled ? state ? "已检查" : "待对账" : "尚未连接"}</span>
              </div>
              {state ? (
                <>
                  <div className="v3-migration-counts">
                    <span>本机 <b>{state.audit.localRecords}</b></span>
                    <span>云端 <b>{state.audit.remoteRecords}</b></span>
                    <span>未解决 <b>{state.audit.unresolved}</b></span>
                  </div>
                  <p>{state.audit.requiresMigrationReview
                    ? "存在历史差异或缺失，禁止直接切换同步；需要逐条审核。"
                    : "当前对账未发现阻断项；正式切换仍需媒体、备份与双设备验收。"}</p>

                  {state.review && (
                    <div className="v3-migration-review" role="region" aria-label={label + "迁移差异明细"}>
                      <p><strong>待核对记录 {state.review.total} 条</strong>
                        {state.review.truncated ? "（仅展示前 " + state.review.displayed + " 条）" : ""}</p>
                      <div className="v3-migration-review-items">
                        {state.review.items.map((item) => (
                          <div key={item.id} className="v3-migration-review-item">
                            <strong title={item.title}>{item.title}</strong>
                            <span>{REVIEW_LABELS[item.action]}</span>
                            <small>差异字段：{item.differingFields.length
                              ? item.differingFields.join("、")
                              : item.localPresent && item.remotePresent ? "待进一步核验" : "仅单侧存在"}</small>
                          </div>
                        ))}
                      </div>
                      <p>仅展示字段名称，不自动选择本机或云端版本，也不上传、删除记录。</p>
                    </div>
                  )}
                  {state.bootstrap && (
                    <p className="v3-migration-result">
                      本次建立一致记录基线 {state.bootstrap.created} 条，
                      并发变化暂缓 {state.bootstrap.deferred} 条；
                      仅保存本机版本摘要。
                    </p>
                  )}
                </>
              ) : <p>先查询本机与云端记录数量、版本差异及需要人工核对的历史记录。</p>}
              <div className="v3-migration-actions">
                <button type="button" className="button ghost"
                  disabled={!enabled || pending !== null}
                  onClick={() => void inspect(provider)}>
                  {pending === provider ? "检查中…" : "只读对账"}
                </button>
                <button type="button" className="button ghost"
                  disabled={!enabled || pending !== null || !state}
                  title="只为内容一致、二次核验仍未变化的记录建立本机版本摘要；不会上传或覆盖"
                  onClick={() => void inspect(provider, true)}>建立一致记录基线</button>
                <button type="button" className="button ghost"
                  disabled={!enabled || pending !== null || !state}
                  onClick={() => void inspect(provider, false, true)}>查看差异明细</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="v3-migration-backup" role="note">
        <strong>备份完整性预检</strong>
        <span>现有 {backupAudit.records} 条记录，共 {backupAudit.assets} 个媒体资源；
          JSON 内嵌媒体候选 {backupAudit.embeddedCandidates} 个，
          仍需单独保存原始文件 {backupAudit.assets - backupAudit.embeddedCandidates} 个。</span>
        {backupAudit.requiresSeparateMediaBackup && (
          <p>云端路径 {backupAudit.storageReferences}、临时 Blob 地址 {backupAudit.transientBlobReferences}、
            外部地址 {backupAudit.externalReferences}、缺失来源 {backupAudit.unavailableReferences}。
            这些引用并不等于图片文件，现有 JSON 不能被认定为完整媒体备份。</p>
        )}
        {!backupAudit.requiresSeparateMediaBackup && (
          <p>当前记录未发现仅有图片引用的资源，但仍须验证导出文件可读及图片字节完整后才能签发迁移备份证明。</p>
        )}
      </div>
      <div className="v3-migration-portable">
        <button className="button ghost" type="button"
          disabled={backupBusy || pending !== null || (!personalConnected && backupAudit.records === 0)}
          onClick={() => void exportVerifiedPortableBackup()}>
          {backupBusy ? "对账云端、验证原图并生成备份…" : personalConnected
            ? "导出本机＋个人云全量可验证备份"
            : "导出仅本机备份（未连接个人云）"}
        </button>
        <span>仅下载到本机，不上传任何数据；单文件图片不超过 32 MiB、全部图片不超过 256 MiB。</span>
        {backupStatus && <p role="status">{backupStatus}</p>}
      </div>
      {error && <p className="v3-migration-error" role="alert">{error}</p>}
      <p className="v3-migration-notice">
        正式切换前仍须核验完整 JSON 与私有图片备份、解决历史分歧，并通过双设备并发测试。
        当前页面不提供任何 V3 云端写入操作，原 V2 同步继续运行。
      </p>
    </section>
  );
}
