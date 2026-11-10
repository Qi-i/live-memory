import { useEffect, useState } from "react";
import { useAccess } from "../../access";
import type { AppSettings, EventRecord } from "../../domain";
import { currentStorageScope, listRecords, readSettings } from "../../storage";
import { hasPersonalCloudConnection } from "../../supabase";
import { V3MigrationPanel } from "./V3MigrationPanel";
import "./v3MigrationLab.css";

interface ArchiveSnapshot {
  scope: string;
  settings: AppSettings;
  records: EventRecord[];
}

/** A truly isolated, explicit, account-authenticated pre-cutover route.
 * Never mounts AppRoot, V2 automatic sync, editors or writer-activation UI.
 * Copies only verified images to a NEW, JWT-scoped private staging bucket when
 * the user manually clicks the staging action; old V2 stays authoritative. */
export function V3MigrationLab() {
  const access=useAccess();
  const [snapshot,setSnapshot]=useState<ArchiveSnapshot|null>(null);
  const [error,setError]=useState("");
  const [generation,setGeneration]=useState(0);

  useEffect(()=>{
    let alive=true;
    setSnapshot(null);
    setError("");
    if(access.mode!=="account"||!access.user?.id)return ()=>{alive=false;};
    const scope=currentStorageScope();
    if(scope!==access.user.id.toLowerCase()){
      setError("账号存储作用域尚未就绪，拒绝访问历史云数据。");
      return ()=>{alive=false;};
    }
    const settings=readSettings();
    void listRecords().then(records=>{
      if(!alive||currentStorageScope()!==scope)return;
      setSnapshot({scope,settings,records});
    }).catch(()=>{
      if(alive&&currentStorageScope()===scope)setError("无法读取此账号的本机档案，已停止所有迁移操作。");
    });
    return ()=>{alive=false;};
  },[access.mode,access.user?.id,generation]);

  const scope=currentStorageScope();
  const valid=access.mode==="account" && snapshot?.scope===scope &&
    scope===access.user?.id?.toLowerCase();
  const connected=valid && snapshot ? hasPersonalCloudConnection(snapshot.settings) : false;

  return (
    <main className="v3-migration-lab" aria-label="Live Memory 私有媒体迁移工具">
      <header className="v3-migration-lab-head">
        <div>
          <small>LIVE MEMORY / 迁移与安全恢复</small>
          <h1>私有媒体迁移工作台</h1>
          <p>独立于正式 V2 运行。先验证历史记录和原图，再将原图复制到当前登录账号的私有暂存区。</p>
        </div>
        <a href="/live-memory/" className="v3-migration-lab-return">返回正式 V2</a>
      </header>
      <section className="v3-migration-lab-status" aria-label="账户和数据状态">
        <span>账号状态：<strong>{access.mode==="account"?"已登录":"未登录"}</strong></span>
        <span>数据模式：<strong>V2 仍为权威来源</strong></span>
        <span>个人云：<strong>{connected?"已连接":"未连接"}</strong></span>
        {valid && <button type="button" onClick={()=>setGeneration(n=>n+1)}>重新读取本机档案</button>}
      </section>
      {error && <p className="v3-migration-lab-warning" role="alert">{error}</p>}
      {!valid && <p className="v3-migration-lab-warning" role="status">
        仅在确认登录账号及本机隔离作用域后开放迁移检查，不支持游客、演示或本机独立账号执行云迁移。
      </p>}
      {valid && snapshot && <>
        {!connected && <p className="v3-migration-lab-warning" role="status">
          尚未连接个人云。请先返回正式 V2 的设置页连接，再打开此工具；禁止依据公开图片链接认领档案。
        </p>}
        <V3MigrationPanel
          key={snapshot.scope}
          settings={snapshot.settings}
          records={snapshot.records}
          personalConnected={connected}
        />
      </>}
      <footer>
        旧公开图片不会在这里删除；账号凭据轮换、最终云端引用切换和正式发布仍须独立验收。
      </footer>
    </main>
  );
}
