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
  const [mirrorFile,setMirrorFile]=useState<File|null>(null);
  const [mirrorPreview,setMirrorPreview]=useState<{
    scope:string;filename:string;total:number;assets:number;bytes:number;
    create:number;already:number;approvalFingerprint:string;
  }|null>(null);
  const [mirrorStatus,setMirrorStatus]=useState("");
  const [mirrorBusy,setMirrorBusy]=useState(false);
  useEffect(() => {
    // Never display results obtained for an earlier account/cloud configuration.
    scopeGeneration.current += 1;
    backupInFlight.current = null;
    setBackupBusy(false);
    setStates({});
    setPending(null);
    setError("");
    setBackupStatus("");
    setMirrorFile(null);
    setMirrorPreview(null);
    setMirrorStatus("");
    setMirrorBusy(false);
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
      // preview dependency graph. Auto-inspection is read-only and account-scoped.
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

  // Read-only record reconciliation is user-initiated. It must never silently
  // compete with the primary authenticated original-media transfer.

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
      // A multi-minute image export can race other devices. Re-list through
      // the same authenticated cloud scope; no changed revision or missing
      // record is allowed to receive a "complete" backup certificate.
      if (cloudRuntime) {
        const remoteAfter = await cloudRuntime.readPersonalCloudForPortableBackup();
        assertScope();
        verifyBackupCloudUnchanged(remoteBefore, remoteAfter);
      }
      // A backup based on stale local state cannot be called complete. Check
      // even inline media bytes (not just timestamps or storage paths).
      const current = await listRecords();
      const originals = new Map(original.map((row) => [row.id, stableSerialize(row)]));
      if (originals.size !== original.length || current.length !== original.length ||
          current.some((row) => originals.get(row.id) !== stableSerialize(row))) {
        throw new Error("V3_BACKUP_LOCAL_CHANGED");
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

  /** User-triggered read-only source-by-source migration proof. The report
   * contains only hashes and blinded future paths, never the legacy ownerKey. */
  async function exportLegacyMediaAudit() {
    if (backupInFlight.current !== null || pending || !personalConnected) return;
    const job=++backupJobCounter.current;
    backupInFlight.current=job;
    const scope=currentStorageScope(),generation=scopeGeneration.current;
    const assertScope=()=>{
      if(scopeGeneration.current!==generation||currentStorageScope()!==scope)
        throw Error("V3_LEGACY_ACCOUNT_CHANGED");
    };
    setBackupBusy(true);
    setBackupStatus("");
    try{
      const [{auditAuthenticatedLegacyMedia},{downloadBlob}] = await Promise.all([
        import("../../infrastructure/supabase/auditLegacyMediaSources"),
        import("../../media"),
      ]);
      assertScope();
      const result=await auditAuthenticatedLegacyMedia(settings,assertScope);
      assertScope();
      // Rejected paths, missing bytes and concurrent changes prevent export.
      // No paths beginning with the old ownerKey enter this portable manifest.
      downloadBlob(JSON.stringify(result),
        "live-memory-legacy-media-audit-"+new Date().toISOString().slice(0,10)+".json",
        "application/json");
      setBackupStatus("历史媒体审计已通过：校验 "+result.objects+
        " 个真实对象、"+result.references+" 条引用，原图共 "+
        (result.totalBytes/(1024*1024)).toFixed(1)+
        " MiB。已下载不含原始鉴权密钥的哈希校验清单；尚未迁移或删除任何对象。");
    }catch(error){
      if(scopeGeneration.current===generation&&currentStorageScope()===scope){
        const code=error instanceof Error?error.message:"";
        setBackupStatus(code.includes("V3_LEGACY_OWNER_NOT_BOUND_TO_ACCOUNT")
          ? "无法证明此旧个人云与当前登录账号绑定。为防止泄露密钥被冒领，已拒绝自动迁移审计。"
          : code.includes("V3_LEGACY_MEDIA_INVENTORY_CHANGED") ||
            code.includes("V3_COMPLETE_BACKUP_CLOUD_CHANGED")
            ? "审计期间云端记录或图片发生变化；已取消验证，所有数据保持原状。"
            : "历史媒体审计未通过：可能有缺失原图、无引用对象或访问失败。没有修改云端数据。");
      }
    }finally{
      if(backupInFlight.current===job){
        backupInFlight.current=null;
        if(scopeGeneration.current===generation&&currentStorageScope()===scope)setBackupBusy(false);
      }
    }
  }

  async function stageLegacyMedia(verifyOnly=false) {
    if(!personalConnected){
      setBackupStatus("未开始：此设备尚未连接旧个人云。请先恢复原有个人云连接；没有修改任何图片。");
      return;
    }
    if(backupInFlight.current!==null){
      setBackupStatus("已有备份或媒体检查正在进行，本次点击没有创建第二个任务。");
      return;
    }
    if(pending){
      setBackupStatus("只读档案对账正在执行，请在其结束后重试原图复制；未开始上传。");
      return;
    }
    const job=++backupJobCounter.current;
    backupInFlight.current=job;
    const scope=currentStorageScope(),generation=scopeGeneration.current;
    const check=()=>{
      if(currentStorageScope()!==scope||scopeGeneration.current!==generation)
        throw Error("V3_LEGACY_ACCOUNT_CHANGED");
    };
    setBackupBusy(true);
    setBackupStatus(verifyOnly
      ? "已开始私有原图只读复核：正在验证登录身份与历史记录，不会上传。"
      : "已开始原图私有复制：正在验证登录身份与历史记录，完成预检后才会上传。");
    try{
      const {
        stageAuthenticatedLegacyMedia,
        verifyAuthenticatedStagedLegacyMedia,
      }=await import("../../infrastructure/supabase/auditLegacyMediaSources");
      check();
      const operation=verifyOnly
        ?verifyAuthenticatedStagedLegacyMedia:stageAuthenticatedLegacyMedia;
      const result=await operation(settings,check,progress=>{
        if(currentStorageScope()!==scope||scopeGeneration.current!==generation)return;
        if(progress.phase==="audit"){
          setBackupStatus("正在检查历史原图："+
            progress.originalsVerified+"/"+progress.originalTotal+
            " 张；只读取源图，不会修改记录。");
        }else{
          setBackupStatus((verifyOnly?"只读复核":"复制并回读")+
            "：已核验原图 "+progress.originalsVerified+"/"+progress.originalTotal+
            " 张；私有副本 "+progress.copiesVerified+"/"+progress.copyTotal+
            " 份。每份均核验原始 SHA-256。");
        }
      });
      check();
      setBackupStatus((verifyOnly?"只读复核成功：":"复制并逐张回读核验成功：")+
        result.objectsVerified+" 张旧原图、"+result.copiesVerified+
        " 份独立私有副本，原文件共 "+
        (result.bytesVerified/(1024*1024)).toFixed(1)+
        " MiB，SHA-256 与源图一致。旧 V2 原件及记录未删除；尚未切换 V3 writer。");
    }catch(error){
      if(currentStorageScope()===scope&&scopeGeneration.current===generation){
        const reason=error instanceof Error?error.message:"";
        setBackupStatus(reason.includes("V3_LEGACY_OWNER_NOT_BOUND_TO_ACCOUNT")
          ? "未复制：当前登录账户的个人云关联配置与旧媒体来源不符。请在现有账户内检查个人云连接。"
          : reason.includes("V3_LEGACY_PROVENANCE_RECORD_COUNT_MISMATCH")||
            reason.includes("V3_LEGACY_PROVENANCE_CONTENT_MISMATCH")||
            reason.includes("V3_LEGACY_PROVENANCE_DELETION_MISMATCH")
            ? "无法完成：同一账户的旧云档案与账号备份存在差异。不会覆盖任何原件。"
            : reason.includes("V3_LEGACY_PROVENANCE_CHANGED")||
              reason.includes("V3_LEGACY_MEDIA_INVENTORY_CHANGED")||
              reason.includes("V3_COMPLETE_BACKUP_CLOUD_CHANGED")
              ? "复制过程中源档案发生变化；已暂存的私有副本不会删除，可再次执行核验。"
              : reason.includes("V3_STAGING_PRIVATE_BYTES_MISMATCH")||
                reason.includes("V3_STAGING_PRIVATE_DOWNLOAD_FAILED")
                ? "私有副本缺失或 SHA 回读不一致；未通过验收，旧原图仍完整保留。可以重新执行安全复制。"
                : reason.includes("V3_STAGING_PRIVATE_UPLOAD_FAILED")
                  ? "私有副本上传被拒绝：当前登录会话或私有桶写入权限异常，请检查登录状态。原图仍完整保留。"
                  : "操作未完成：媒体字节不可用、云端网络或权限校验失败；所有旧原图和账号记录保持不变。"
                + (/^V3_[A-Z0-9_]+$/.test(reason) ? " 错误编号："+reason : ""));
      }
    }finally{
      if(backupInFlight.current===job){
        backupInFlight.current=null;
        if(currentStorageScope()===scope&&scopeGeneration.current===generation)setBackupBusy(false);
      }
    }
  }

  /** Two user actions: preview a fully verified portable file, then copy
   * into a NEW JWT-protected full-media mirror. Legacy V2 is unchanged. */
  async function runMirrorImport(action:"inspect"|"copy") {
    const file=mirrorFile;
    if(!file||backupInFlight.current!==null||pending!==null)return;
    const scope=currentStorageScope(),generation=scopeGeneration.current;
    const check=()=>{
      if(currentStorageScope()!==scope||scopeGeneration.current!==generation)
        throw Error("V3_MIRROR_ACCOUNT_CHANGED");
    };
    if(action==="copy"&&(!mirrorPreview||mirrorPreview.scope!==scope||
        mirrorPreview.filename!==file.name))return;
    const job=++backupJobCounter.current;
    backupInFlight.current=job;
    setMirrorBusy(true);
    setMirrorStatus("");
    try{
      if(file.size>400*1024*1024)throw Error("V3_MIRROR_BACKUP_TOO_LARGE");
      const raw=await file.text();
      check();
      const hashed=new Uint8Array(await crypto.subtle.digest(
        "SHA-256",new TextEncoder().encode(raw),
      ));
      check();
      const fileSha256=Array.from(hashed,x=>x.toString(16).padStart(2,"0")).join("");
      const parsed=JSON.parse(raw);
      check();
      const {mirrorApprovalFingerprint,verifyMirrorApproval}=
        await import("../../core/application/verifyApprovedMirrorCopy");
      const {inspectSecureArchiveMirror,importSecureArchiveMirror}=
        await import("../../infrastructure/supabase/importSecureArchiveMirror");
      check();
      if(action==="inspect"){
        const review=await inspectSecureArchiveMirror(parsed);
        check();
        setMirrorPreview({
          scope,filename:file.name,total:review.records,assets:review.assets,
          bytes:review.bytes,create:review.toCreate.length,
          already:review.alreadyPresent,
          approvalFingerprint:mirrorApprovalFingerprint(fileSha256,review),
        });
        setMirrorStatus("已核验原图字节与现有私有档案：总记录 "+
          review.records+" 条，其中新建 "+review.toCreate.length+
          " 条、已存在且完全一致 "+review.alreadyPresent+
          " 条。再次点击确认后，仅复制到新的私有镜像，不会修改旧 V2 数据。");
      }else{
        // The selected file can change between preview and confirmation.
        // Also re-read the authenticated remote plan before ANY new object
        // upload so previously unapproved changes cannot be silently copied.
        const currentPlan=await inspectSecureArchiveMirror(parsed);
        check();
        verifyMirrorApproval(
          mirrorPreview!.approvalFingerprint,
          mirrorApprovalFingerprint(fileSha256,currentPlan),
        );
        check();
        const result=await importSecureArchiveMirror(parsed);
        check();
        setMirrorPreview(null);
        setMirrorFile(null);
        setMirrorStatus("私有档案镜像复制完成：新建 "+result.created+
          " 条，已存在且一致 "+result.alreadyPresent+
          " 条，经过源文件与云端回读核验的图片 "+result.mediaVerified+
          " 个。V2 记录与旧图片仍保留，尚未切换写入。");
      }
    }catch(failure){
      if(currentStorageScope()===scope&&scopeGeneration.current===generation){
        const reason=failure instanceof Error?failure.message:"";
        setMirrorPreview(null);
        setMirrorStatus(reason.includes("APPROVED_FILE_OR_REMOTE_PLAN_CHANGED")
          ? "文件内容或账号私有档案已在预览后变化，已拒绝复制。请重新检查原图与档案数量后再次确认。"
          : reason.includes("EXISTING_RECORD_CONFLICT")||
          reason.includes("CONCURRENT_CONFLICT")
          ? "镜像中有相同 ID 但内容不同的档案，已停止复制；绝不自动覆盖任何一侧。"
          : reason.includes("MIRROR_ACCOUNT")?"登录账号或本机作用域已变化，本次操作中止。"
          : "未能完成私有档案镜像核验/复制：文件、原图、网络或云端版本可能不一致。已复制的正确副本可安全重试；V2 原件不变。");
      }
    }finally{
      if(backupInFlight.current===job){
        backupInFlight.current=null;
        if(currentStorageScope()===scope&&scopeGeneration.current===generation)
          setMirrorBusy(false);
      }
    }
  }

  return (
    <section className="settings-module v3-migration-panel" aria-label="V3 数据迁移诊断">
      <header className="v3-migration-head">
        <div>
          <span>当前登录账户 · 数据来源核对</span>
          <h3>统一档案与原图</h3>
          <p>只有一个账户，历史文字备份与个人云是同一账户的两种来源。原图复制与档案对账分开执行；不会删除原图、记录或改动同步权限。</p>
        </div>
        <strong>原图私有迁移</strong>
      </header>
      <div className="v3-migration-primary" role="region" aria-label="原图私有复制">
        <div className="v3-migration-primary-heading">
          <strong>原图私有复制与SHA-256验收</strong>
          <span>原图保留 · 中断可安全重试 · 不启动V3云端写入</span>
        </div>
        <div className="v3-migration-primary-actions">
          <button type="button" className="button v3-migration-upload"
            disabled={backupBusy} onClick={()=>void stageLegacyMedia()}>
            {backupBusy?"正在执行，请查看下方进度…":"开始原图私有复制"}
          </button>
          <button type="button" className="button ghost"
            disabled={backupBusy} onClick={()=>void stageLegacyMedia(true)}>
            只读复核已复制原图
          </button>
        </div>
        {!personalConnected && <p role="note">此设备尚未连接原个人云；点击复制可查看具体缺少的配置，不会修改原图。</p>}
        {pending && <p role="note">正在执行{pending==="account"?"账号文字备份":"个人云"}对账；请先完成该检查。</p>}
        {backupStatus && <p className="v3-migration-live-status" role="status"
          aria-live="polite">{backupStatus}</p>}
      </div>
      <div className="v3-migration-grid">
        {(["account", "personal"] as Provider[]).map((provider) => {
          const enabled = provider === "account" || personalConnected;
          const state = states[provider];
          const label = provider === "account" ? "文字备份来源" : "个人云原图来源";
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
              ) : <p>正在核对同一账户的历史来源；可在此查看差异明细和原图暂存结果。</p>}
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
      <div className="v3-migration-portable" role="region" aria-label="其他备份工具">
        <button className="button ghost" type="button"
          disabled={backupBusy || pending !== null || (!personalConnected && backupAudit.records === 0)}
          onClick={() => void exportVerifiedPortableBackup()}>
          {backupBusy ? "对账云端、验证原图并生成备份…" : personalConnected
            ? "导出本机＋个人云全量可验证备份"
            : "导出仅本机备份（未连接个人云）"}
        </button>
        {personalConnected && <button className="button ghost" type="button"
          disabled={backupBusy||pending!==null}
          onClick={()=>void exportLegacyMediaAudit()}>
          {backupBusy?"正在检查云端原图…":"生成旧公开媒体逐对象迁移校验清单"}
        </button>}
      </div>
      <div className="v3-migration-portable" role="region" aria-label="账号私有完整档案镜像导入">
        <strong>私有完整档案镜像 · 迁移预演</strong>
        <p>选择之前导出的、包含全部原图的可验证备份。先检查图片哈希及账号云端冲突，再手动确认复制。
        数据只写入新建的账号私有镜像表和私有图片空间，不修改旧版档案或启动新同步。</p>
        <input type="file" accept=".json,application/json"
          aria-label="选择已验证的完整档案备份"
          disabled={mirrorBusy||backupBusy||pending!==null}
          onChange={event=>{
            const chosen=event.currentTarget.files?.[0]||null;
            setMirrorFile(chosen);setMirrorPreview(null);setMirrorStatus("");
          }}/>
        <button className="button ghost" type="button"
          disabled={!mirrorFile||mirrorBusy||backupBusy||pending!==null}
          onClick={()=>void runMirrorImport("inspect")}>
          {mirrorBusy?"校验备份中…":"检查图片与私有档案差异（不写入）"}
        </button>
        {mirrorPreview && mirrorPreview.scope===currentStorageScope() && (
          <div className="v3-migration-result">
            <p>记录 {mirrorPreview.total} 条 · 图片 {mirrorPreview.assets} 个 ·
              新建 {mirrorPreview.create} 条 · 已存在 {mirrorPreview.already} 条</p>
            <button className="button ghost" type="button" disabled={mirrorBusy||backupBusy||pending!==null}
              onClick={()=>void runMirrorImport("copy")}>
              确认复制到账号私有镜像（不替换 V2）
            </button>
          </div>
        )}
        {mirrorStatus && <p role="status">{mirrorStatus}</p>}
      </div>
      {error && <p className="v3-migration-error" role="alert">{error}</p>}
      <p className="v3-migration-notice">
        正式切换前仍须核验完整 JSON 与私有图片备份、解决历史分歧，并通过双设备并发测试。
        本页面不切换 V3 写入模式、不修改现有 V2 档案；独立私有暂存区仅存放有校验的原图副本，原 V2 同步继续运行。
      </p>
    </section>
  );
}
