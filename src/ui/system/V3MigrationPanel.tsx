import { useEffect, useMemo, useRef, useState } from "react";
import { currentStorageScope } from "../../storage";
import type { AppSettings, EventRecord } from "../../domain";
import { auditBackupPortability } from "../../core/application/auditBackupPortability";
import type { ReadOnlySyncAudit } from "../../core/application/auditSyncReadOnly";
import type { BaselineBootstrapReport } from "../../core/application/bootstrapEquivalentBaselines";
import "./v3MigrationPanel.css";

type Provider = "account" | "personal";
interface ProviderState {
  audit: ReadOnlySyncAudit;
  bootstrap?: BaselineBootstrapReport;
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
  useEffect(() => {
    // Never display results obtained for an earlier account/cloud configuration.
    scopeGeneration.current += 1;
    setStates({});
    setPending(null);
    setError("");
    return () => { scopeGeneration.current += 1; };
  }, [settings.supabase.url, settings.supabase.ownerKey]);

  async function inspect(provider: Provider, bootstrap = false) {
    if (pending) return;
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
      const audit = await runtime.audit();
      if (scopeGeneration.current !== requestGeneration || currentStorageScope() !== requestScope) return;
      setStates((current) => ({
        ...current,
        [provider]: { audit, bootstrap: baseline ?? current[provider]?.bootstrap },
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
      {error && <p className="v3-migration-error" role="alert">{error}</p>}
      <p className="v3-migration-notice">
        正式切换前仍须核验完整 JSON 与私有图片备份、解决历史分歧，并通过双设备并发测试。
        当前页面不提供任何 V3 云端写入操作，原 V2 同步继续运行。
      </p>
    </section>
  );
}
