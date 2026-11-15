import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { BrandMark } from "../../brand";
import { useAccess } from "../../access";
import type { EventRecord, MediaAsset } from "../../domain";
import { primaryMedia, mediaKindLabels, sourceLabels, statusLabels, categoryLabels, createId } from "../../domain";
import { currentStorageScope, listRecords, normalizeRecord, readSettings } from "../../storage";
import type { V3SyncRuntime, V3ConflictPreview } from "../../infrastructure/createV3SyncRuntime";
import { listProtectedConflictVersions, readProtectedConflictVersion,
  type ProtectedConflictSummary } from "../../infrastructure/indexedDb/v3ConflictVault";
import { resolveMediaSource, useCachedMediaSrc } from "../../mediaCache";
import { describeRealArchive, isWatchedRealRecord } from "../../core/application/describeRealArchive";
import { saveRecordDraft } from "../../core/application/saveRecordDraft";
import { IndexedDbRecordRepository } from "../../infrastructure/indexedDb/recordRepository";
import { listPendingEditors, stagePendingEditor, removePendingEditor,
  type PendingEditorRow } from "../../infrastructure/indexedDb/pendingEditorDrafts";
import { RecordEditor } from "../../overlays";
import { blankRecord } from "../../seeds";
import { ShareStudio, type ShareFormat } from "../../shareStudio";
import { duplicateRecordForNextShow } from "../../recordActions";
import { hasPersonalCloudConnection } from "../../supabase";
import { ConfirmDialog, ImageZoom, ImportDrawer } from "../../overlays";
import { V3MigrationPanel } from "../system/V3MigrationPanel";
import { ActionToolbar, MapSplitPane, WorkspaceShell } from "../system/WorkspaceShell";
import { useDialogBehavior } from "../useDialogBehavior";
import { curateFeaturedRecords } from "./curateFeaturedRecords";
import { V3FeaturedHero } from "./V3FeaturedHero";
import { AdaptivePoster } from "./AdaptivePoster";
import { dominantPosterRatio } from "./posterFraming";
import {V3ArchiveCollections,collectionModes,type CollectionMode} from "./V3ArchiveCollections";
import "../system/preview.css";
import "./realWorkspace.css";
import "./v3ShareStudio.css";
import "./adaptivePoster.css";
import "./v3ArchiveRefinements.css";
import "./v3Collections.css";

type Page = "档案" | "统计" | "城市" | "数据";
type Mode = "海报"|"时间线"|"列表"|CollectionMode;
const navigation: Array<Exclude<Page,"数据">> = ["档案", "统计", "城市"];
const archiveModes:Mode[]=["海报","时间线","列表"];
const viewPreferenceKey="live-memory-v3-archive-view";
function savedArchiveMode():Mode{
  try{
    const stored=window.localStorage.getItem(viewPreferenceKey) as Mode|null;
    return stored && [...archiveModes,...collectionModes].includes(stored) ? stored : "海报";
  }catch{return "海报";}
}

function backToV2() {
  if(import.meta.env.VITE_V3_BETA==="1"){
    // The beta hostname is intentionally a separate origin; it does not
    // contain the production V2 bundle or the user's old local IndexedDB.
    window.location.assign("https://qi-i.github.io/live-memory/");
    return;
  }
  const url = new URL(window.location.href);
  if (import.meta.env.VITE_V3_PRODUCTION === "1") {
    url.searchParams.set("v2-classic", "1");
  } else {
    url.searchParams.delete("v3-real-workspace");
  }
  window.location.assign(url.href);
}
function PosterCard({record,onOpen,onEdit,frameRatio,onNaturalRatio}:{
  record:EventRecord;
  onOpen:(id:string)=>void;
  onEdit?: (record:EventRecord)=>void;
  frameRatio:number;
  onNaturalRatio:(id:string,ratio:number)=>void;
}){
  const src=useCachedMediaSrc(primaryMedia(record, ["poster"]));
  return <article className="v3-real-poster-card" data-record-id={record.id}>
    <button className="v3-real-poster-open" type="button" onClick={()=>onOpen(record.id)}
      aria-label={"查看 "+record.title}>
      <AdaptivePoster className="v3-real-poster-image" src={src}
        alt={record.title+"海报"} frameRatio={frameRatio}
        onNaturalRatio={ratio=>onNaturalRatio(record.id,ratio)}/>
      <span className="v3-real-poster-meta">
        <strong title={record.title}>{record.title}</strong>
        <small>{record.date} · {record.city||"城市待补"}</small>
      </span>
    </button>
    {onEdit&&<button className="v3-real-poster-edit" type="button"
      onClick={()=>onEdit(record)} aria-label={"编辑 "+record.title}
      title={"编辑 "+record.title}><Pencil size={16} aria-hidden="true"/></button>}
  </article>;
}
function RecordMediaPreview({media,onOpen}:{
  media:MediaAsset;onOpen:(media:MediaAsset)=>void;
}){
  const src=useCachedMediaSrc(media);
  return <button type="button" className="v3-real-media-preview" onClick={()=>onOpen(media)}>
    {src?<img src={src} alt={media.title||mediaKindLabels[media.kind]} loading="lazy"/>:
      <span>暂无预览</span>}
    <small>{mediaKindLabels[media.kind]}{media.title?" · "+media.title:""}</small>
  </button>;
}
function RecordDetail({record,onClose,onEdit,onDuplicate,onTrash,onShare,onZoom}:{
  record:EventRecord;onClose:()=>void;onEdit?:(record:EventRecord)=>void;
  onDuplicate?:(record:EventRecord)=>void;onTrash?:(record:EventRecord)=>void;
  onShare:(record:EventRecord)=>void;
  onZoom:(media:MediaAsset)=>void;
}){
  const src=useCachedMediaSrc(primaryMedia(record, ["poster"]));
  const detailRef=useDialogBehavior<HTMLElement>({
    onClose, focusSelector:'button[aria-label="关闭档案详情"]',
  });
  return <div className="v3-real-modal-backdrop" role="presentation"
    onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section ref={detailRef} className="v3-real-modal v3-real-rich-detail" role="dialog"
      aria-modal="true" aria-label={record.title+"（档案详情）"}>
      <header>
        <div><small>LIVE MEMORY · EVENT ARCHIVE</small><h2>{record.title}</h2>
          <span>{record.date} · {record.city} · {record.venue}</span></div>
        <div className="v3-real-detail-header-actions">
          {onEdit&&<button type="button" aria-label="编辑本机演出"
            onClick={()=>onEdit(record)}>编辑</button>}
          <button type="button" aria-label="关闭档案详情" onClick={onClose}>×</button>
        </div>
      </header>
      <div className="v3-real-modal-body">
        <button className="v3-real-modal-art" type="button"
          disabled={!primaryMedia(record, ["poster"])}
          onClick={()=>{const art=primaryMedia(record, ["poster"]);if(art)onZoom(art);}}
          aria-label={primaryMedia(record, ["poster"])?"放大主海报":"此记录没有可放大的主海报"}>
          {src?<img src={src} alt={record.title+"海报"}/>:<span>此记录暂无可用海报</span>}
        </button>
        <dl>
          <dt>类别</dt><dd>{categoryLabels[record.category]}</dd>
          <dt>艺人</dt><dd>{record.artists.join("、")||"未填写"}</dd>
          <dt>演出时间</dt><dd>{record.date}{record.time?" "+record.time:""}</dd>
          <dt>场馆</dt><dd>{record.venue||"未填写"}{record.address?" · "+record.address:""}</dd>
          <dt>状态</dt><dd>{statusLabels[record.status]}{record.recordState!=="normal"?" · "+record.recordState:""}</dd>
          {record.price!=null&&<><dt>票价</dt><dd>¥{record.price}</dd></>}
          {record.seat&&<><dt>座位</dt><dd>{record.seat}</dd></>}
          {record.sourceChannel&&<><dt>购票渠道</dt><dd>{sourceLabels[record.sourceChannel]}</dd></>}
          {record.companions.length>0&&<><dt>同行</dt><dd>{record.companions.join("、")}</dd></>}
          <dt>媒体</dt><dd>{record.media.length} 项</dd>
          <dt>标签</dt><dd>{record.tags.join("、")||"无"}</dd>
          {record.setlist.length>0&&<><dt>歌单</dt><dd>{record.setlist.join(" / ")}</dd></>}
          {record.note&&<><dt>备注</dt><dd className="v3-real-detail-note">{record.note}</dd></>}
        </dl>
      </div>
      {record.media.length>0&&<section className="v3-real-detail-media">
        <h3>现场媒体 <small>· {record.media.length} 项</small></h3>
        <div className="v3-real-media-grid">
          {record.media.map(media=><RecordMediaPreview key={media.id} media={media} onOpen={onZoom}/>)}
        </div>
      </section>}
      <footer><span>原图始终保留，编辑采用版本校验。</span>
        <div className="v3-real-detail-actions">
          <button type="button" onClick={()=>onShare(record)}>分享本场</button>
          {onDuplicate&&<button type="button" onClick={()=>onDuplicate(record)}>复制为下一场</button>}
          {onTrash&&<button className="v3-real-detail-danger" type="button" onClick={()=>onTrash(record)}>移入回收站</button>}
          <button type="button" onClick={onClose}>返回档案</button>
        </div>
      </footer>
    </section>
  </div>;
}
function RecordIndexCard({record,onOpen,onEdit,frameRatio}:{
  record:EventRecord;
  onOpen:(id:string)=>void;
  onEdit?: (record:EventRecord)=>void;
  frameRatio:number;
}){
  const src=useCachedMediaSrc(primaryMedia(record, ["poster"]));
  return <article className="v3-real-index-row" data-record-id={record.id}>
    <AdaptivePoster className="v3-real-index-thumb" src={src} alt="" frameRatio={frameRatio}/>
    <button type="button" className="v3-real-index-heading" onClick={()=>onOpen(record.id)}>
      <strong>{record.title}</strong>
      <small>{record.artists.join(" · ")||"艺人待补"} · {record.venue||"场馆待补"}</small>
    </button>
    <time>{record.date||"日期待补"}</time>
    <span className="v3-real-index-place">{record.city||"城市待补"}</span>
    <div className="v3-real-index-actions">
      {onEdit&&<button type="button" onClick={()=>onEdit(record)}>编辑</button>}
      <button type="button" onClick={()=>onOpen(record.id)}>查看</button>
    </div>
  </article>;
}
function RealStatistics({ records }: { records: EventRecord[] }) {
  const data = useMemo(() => describeRealArchive(records), [records]);
  return (
    <section className="v3-real-panel">
      <header><span>YOUR REAL DATA · READ ONLY</span><h1>观演统计</h1>
        <p>按本机实际档案计算，取消、退款和删除的记录不计入已看场次。</p></header>
      <div className="v3-real-metrics">
        <article><strong>{data.records.length}</strong><span>有效档案</span></article>
        <article><strong>{data.watchedCount}</strong><span>已看演出</span></article>
        <article><strong>{data.cities.length}</strong><span>涉及城市</span></article>
        <article><strong>{data.mediaCount}</strong><span>媒体附件</span></article>
      </div>
      <div className="v3-real-breakdown">
        <div><h2>年度分布</h2>
          {data.years.map(item => <div className="v3-real-bar-row" key={item.year}>
            <span>{item.year}</span>
            <div><i style={{width:100*item.total/Math.max(1,...data.years.map(r=>r.total))+"%"}} /></div>
            <b>{item.total}</b></div>)}
          {!data.years.length && <p>暂无有效日期记录。</p>}
        </div>
        <div><h2>城市分布</h2>
          {data.cities.slice(0,20).map(item => <div className="v3-real-bar-row" key={item.city}>
            <span title={item.city}>{item.city}</span>
            <div><i style={{width:100*item.total/Math.max(1,...data.cities.map(r=>r.total))+"%"}} /></div>
            <b>{item.total}</b></div>)}
          {!data.cities.length && <p>暂无城市数据。</p>}
        </div>
      </div>
    </section>
  );
}
function RealCityMap({ records, chosenCity }: { records: EventRecord[]; chosenCity: string | null }) {
  const positions = records.filter(r => r.coordinates &&
    Number.isFinite(r.coordinates.lng) && Number.isFinite(r.coordinates.lat) &&
    Math.abs(r.coordinates.lng) <= 180 && Math.abs(r.coordinates.lat) <= 90);
  const providers = new Set(positions.map(r => r.coordinates?.provider || "unmarked"));
  // Different coordinate reference systems must not be mixed in a fake map.
  const mapped = providers.size <= 1 ? positions : [];
  const allX = mapped.map(r => r.coordinates!.lng);
  const allY = mapped.map(r => r.coordinates!.lat);
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  return (
    <div className="v3-real-map">
      <span>COORDINATE VIEW · REAL DATA</span><h2>已记录的经纬度</h2>
      <p>仅展示档案中实际保存的坐标。相对位置示意，无地图底图，不用于距离测量。</p>
      {mapped.length ? <svg role="img" aria-label={mapped.length+" 条带坐标的演出分布"} viewBox="0 0 1000 480"
        preserveAspectRatio="xMidYMid meet">
        <rect x="16" y="16" width="968" height="448" rx="14" fill="none" stroke="currentColor" opacity=".15"/>
        {mapped.map(row => {
          const point = row.coordinates!;
          const x = 65 + (maxX === minX ? .5 : (point.lng-minX)/(maxX-minX))*870;
          const y = 430 - (maxY === minY ? .5 : (point.lat-minY)/(maxY-minY))*375;
          return <g key={row.id} opacity={chosenCity && chosenCity !== row.city ? .22 : 1}>
            <circle cx={x} cy={y} r={chosenCity===row.city?11:8}
              fill={chosenCity===row.city?"#7563bd":"#4c82b8"} stroke="white" strokeWidth="2"/>
            <title>{row.title} · {row.city}</title>
          </g>;
        })}
      </svg> : <div className="v3-real-map-empty">
        {providers.size > 1 ? "坐标系混用，已停止叠加显示以免产生错误位置。" :
          "当前档案没有可直接绘制的有效经纬度，未虚构任何城市坐标。"}
      </div>}
      <small>{mapped.length} 条有效坐标 / {records.length} 条档案
        {chosenCity ? " · 已选择 " + chosenCity : ""}</small>
    </div>
  );
}
function RealCityView({ records, onOpen }: { records: EventRecord[]; onOpen: (id: string) => void }) {
  const data=useMemo(()=>describeRealArchive(records),[records]);
  const [city,setCity]=useState<string|null>(null);
  const selected=data.records.filter(row=>row.city===city);
  return <MapSplitPane
    map={<RealCityMap records={data.records} chosenCity={city} />}
    list={<div className="v3-real-city-list">
      <header><span>ACTUAL FOOTPRINTS</span><h2>城市与场馆</h2>
        <p>来自真实档案，点击城市查看对应演出。</p></header>
      {data.cities.map(item=><button type="button" key={item.city} aria-pressed={item.city===city}
        onClick={()=>setCity(item.city===city?null:item.city)}>
        <strong title={item.city}>{item.city}</strong><span>已看 {item.watched}</span><b>{item.total}</b>
      </button>)}
      {!data.cities.length && <p>尚无城市记录。</p>}
    </div>}
    detail={city && <div className="v3-real-map-details">
      <header><strong>{city} · {selected.length} 场</strong>
        <button type="button" onClick={()=>setCity(null)} aria-label="关闭城市记录">×</button></header>
      {selected.map(row=><button type="button" key={row.id} onClick={()=>onOpen(row.id)}>
        <strong>{row.title}</strong><small>{row.date} · {row.venue}</small>
      </button>)}
    </div>}
  />;
}
export function V3RealWorkspace() {
  const access=useAccess();
  const [page,setPage]=useState<Page>("档案");
  const [showLegacyDiagnostics,setShowLegacyDiagnostics]=useState(false);
  const [mode,setMode]=useState<Mode>(savedArchiveMode);
  useEffect(()=>{
    try{window.localStorage.setItem(viewPreferenceKey,mode);}catch{ /* private browsing */ }
  },[mode]);
  const [search,setSearch]=useState("");
  const [filterStatus,setFilterStatus]=useState<"all"|"watched"|"planned"|"wish">("all");
  const [filterCity,setFilterCity]=useState("");
  const [filterYear,setFilterYear]=useState("");
  const [favoritesOnly,setFavoritesOnly]=useState(false);
  const [sortMode,setSortMode]=useState<"newest"|"oldest"|"edited">("newest");
  const [snapshot,setSnapshot]=useState<{scope:string;records:EventRecord[];error:string;busy:boolean}>({
    scope:"",records:[],error:"",busy:true,
  });
  const [reload,setReload]=useState(0);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [sharing,setSharing]=useState(false);
  const [shareRecord,setShareRecord]=useState<EventRecord|null>(null);
  const [zoomMedia,setZoomMedia]=useState<MediaAsset|null>(null);
  const [deleteCandidate,setDeleteCandidate]=useState<EventRecord|null>(null);
  const [importOpen,setImportOpen]=useState(false);
  const [shareFormat,setShareFormat]=useState<ShareFormat>("adaptive-portrait");
  const [restoreBusy,setRestoreBusy]=useState(false);
  const [pendingEditors,setPendingEditors]=useState<PendingEditorRow[]>([]);
  const [pendingEditorsError,setPendingEditorsError]=useState("");
  const [exportBusy,setExportBusy]=useState(false);
  const [restorePreview,setRestorePreview]=useState<{
    scope:string;name:string;document:unknown;records:number;assets:number;bytes:number;
  }|null>(null);
  const [editing,setEditing]=useState<{draft:EventRecord;baseline:EventRecord|null;scope:string}|null>(null);
  const [notice,setNotice]=useState("");
  const [cloudMode,setCloudMode]=useState<{scope:string;mode:"v2"|"v3";error:string}>({
    scope:"",mode:"v2",error:"",
  });
  const accountRuntime=useRef<{scope:string;runtime:V3SyncRuntime}|null>(null);
  const rescueStarted=useRef<Set<string>>(new Set());
  const [syncBusy,setSyncBusy]=useState(false);
  const [conflictPreview,setConflictPreview]=useState<{scope:string;entry:V3ConflictPreview}|null>(null);
  const [protectedVersions,setProtectedVersions]=useState<ProtectedConflictSummary[]>([]);
  const [syncReview,setSyncReview]=useState<{
    scope:string;checked:number;unresolved:number;
    details:Awaited<ReturnType<V3SyncRuntime["review"]>>;
  }|null>(null);
  const [transferApproval,setTransferApproval]=useState<{
    scope:string;push:number;pull:number;
  }|null>(null);
  const [posters,setPosters]=useState<Array<{id:string;title:string;city:string;src?:string}>>([]);
  const [posterRatios,setPosterRatios]=useState<Record<string,number>>({});
  const actualScope=currentStorageScope();
  const permitted=access.mode==="account" || access.mode==="device";
  const validScope=permitted && Boolean(actualScope) &&
    (access.mode==="device" || actualScope===access.user?.id?.toLowerCase());
  useEffect(()=>{
    // V2 and V3 writers may NEVER run together. This route intentionally
    // does not mount AppRoot/V2 timers, but a server cutover marker remains
    // mandatory even for creating a local draft in an authenticated account.
    let alive=true;
    const scope=currentStorageScope();
    accountRuntime.current=null;
    setCloudMode({scope:"",mode:"v2",error:""});
    setTransferApproval(null);
    if (access.mode==="account" && validScope && scope===access.user?.id?.toLowerCase()) {
      void (async()=>{
        const {createV3SyncRuntime}=await import("../../infrastructure/createV3SyncRuntime");
        const runtime=await createV3SyncRuntime(readSettings(),"secure-account");
        const mode=await runtime.writerMode();
        if(!alive||currentStorageScope()!==scope)return;
        accountRuntime.current={scope,runtime};
        let readyForRescue=false;
        let needsReload=false;
        if(mode==="v3"){
          // A freshly installed browser has no V2 IndexedDB. Recover the
          // already-owned cloud archive automatically; do not require JSON
          // export/import or a second manual "approve initial download" click.
          // Never auto-merge when any local history or conflict exists.
          try{
            const local=await listRecords();
            if(!alive||currentStorageScope()!==scope)return;
            if(local.length===0){
              const review=await runtime.audit();
              if(!alive||currentStorageScope()!==scope)return;
              if(!review.requiresMigrationReview &&
                 review.actions["push-new"]===0 &&
                 review.actions["pull-new"]>0){
                await runtime.synchronize({
                  v2AutoSyncDisabled:true,initialTransferApproved:true,
                });
                if(alive&&currentStorageScope()===scope){
                  needsReload=true;
                  setReload(n=>n+1);
                  setNotice("已从当前账号的 V3 云端自动恢复档案及原图引用。");
                }
              }
            }else{
              const changed=await runtime.adoptMatchingLegacyBrowserHistory();
              if(alive&&currentStorageScope()===scope&&changed>0){
                needsReload=true;
                setReload(n=>n+1);
                setNotice(`已核对并自动接管 ${changed} 条旧版档案的媒体路径；原始数据仍完整保留。`);
              }
            }
            readyForRescue=true;
          }catch{
            if(alive&&currentStorageScope()===scope)
              setNotice("已保留本机旧版档案：云端和本机存在未同步差异，或原图暂不可用。没有自动覆盖任何内容。");
          }
        }
        if(alive&&currentStorageScope()===scope)
          setCloudMode({scope,mode,error:""});
        if(alive&&readyForRescue&&!needsReload&&!rescueStarted.current.has(scope)){
          // This process is optional and runs after the archive is available.
          // It cannot modify the user's original V2 browser history first.
          rescueStarted.current.add(scope);
          void import("../../infrastructure/supabase/rescueHistoricalCdnOriginals")
            .then(module=>module.rescueHistoricalCdnOriginals(
              scope,()=>alive&&currentStorageScope()===scope,
            ))
            .then(async result=>{
              if(!alive||currentStorageScope()!==scope)return;
              if(result.recovered>0){
                // Reconcile cloud CAS versions into the local V3 ledger and
                // cache the now-private originals before refreshing the views.
                await runtime.synchronize({v2AutoSyncDisabled:true});
                if(alive&&currentStorageScope()===scope){
                  setNotice(`已将 ${result.recovered} 项历史海报/座位图原图复制到账号私有存储；${result.remaining} 项仍待回收。`);
                  setReload(n=>n+1);
                }
              }else if(result.failed>0){
                setNotice(`已检查历史媒体：${result.failed} 项原图暂无法从原网站获取，原链接和档案保持不变。`);
              }
            }).catch(()=>{
              // Never block normal archive browsing because the CDN is down,
              // or because local edits became concurrent with a cloud CAS.
            });
        }
      })().catch(()=>{
        if(alive&&currentStorageScope()===scope)
          setCloudMode({scope,mode:"v2",error:"账号写入状态无法验证，已保持只读。"});
      });
    }
    return ()=>{alive=false;accountRuntime.current=null;};
  },[access.mode,access.user?.id,validScope,actualScope,reload]);

  useEffect(()=>{
    let alive=true;
    const scope=currentStorageScope();
    setSelectedId(null);
    setEditing(null);
    setZoomMedia(null);
    setDeleteCandidate(null);
    setImportOpen(false);
    setSharing(false);
    setPosters([]);
    setSnapshot({scope,records:[],error:"",busy:true});
    if (!validScope) {
      setSnapshot({scope,records:[],error:"当前尚无匹配的私有档案身份。",busy:false});
      return ()=>{alive=false;};
    }
    void listRecords().then(rows=>{
      if(!alive||currentStorageScope()!==scope)return;
      setSnapshot({scope,records:rows,error:"",busy:false});
    }).catch(()=>{
      if(alive&&currentStorageScope()===scope)setSnapshot({
        scope,records:[],error:"本机档案读取失败，未对任何数据进行更改。",busy:false,
      });
    });
    return ()=>{alive=false;};
  },[access.mode,access.user?.id,validScope,reload]);
  // A manual refresh must not erase the save confirmation. Only switching
  // accounts should clear the status notice from the previous identity.
  useEffect(()=>{setNotice("");setRestorePreview(null);setSharing(false);},[access.mode,access.user?.id]);
  useEffect(()=>{
    const scope=currentStorageScope();
    let alive=true;
    setPendingEditors([]);
    setPendingEditorsError("");
    setConflictPreview(null);
    setProtectedVersions([]);
    if(validScope && access.mode==="account"){
      void listProtectedConflictVersions(scope).then(rows=>{
        if(alive && currentStorageScope()===scope)setProtectedVersions(rows);
      }).catch(()=>{
        if(alive && currentStorageScope()===scope)
          setPendingEditorsError("历史冲突保留版本暂无法读取；未删除任何资料。");
      });
    }
    if(validScope && access.mode==="account"){
      void listPendingEditors(scope).then(rows=>{
        if(alive&&currentStorageScope()===scope)setPendingEditors(rows);
      }).catch(()=>{
        if(alive&&currentStorageScope()===scope)
          setPendingEditorsError("本机待提交草稿暂无法读取，现有档案不受影响。");
      });
    }
    return ()=>{alive=false;};
  },[access.mode,access.user?.id,validScope,reload]);
  const records=snapshot.scope===actualScope?snapshot.records:[];
  const trashedRecords=useMemo(()=>records.filter(row=>Boolean(row.deletedAt))
    .sort((a,b)=>(b.deletedAt||"").localeCompare(a.deletedAt||"")),[records]);
  const frameRatio=useMemo(()=>dominantPosterRatio(Object.values(posterRatios)),
    [posterRatios]);
  const measurePoster=(id:string,ratio:number)=>{
    setPosterRatios(previous=>previous[id]===ratio?previous:{...previous,[id]:ratio});
  };
  const model=useMemo(()=>describeRealArchive(records,search),[records,search]);
  const facets=useMemo(()=>{
    const all=describeRealArchive(records).records;
    return {
      cities:[...new Set(all.map(row=>row.city.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh")),
      years:[...new Set(all.map(row=>row.date.slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort().reverse(),
    };
  },[records]);
  const active=useMemo(()=>model.records.filter(row=>
    (filterStatus==="all"||(filterStatus==="watched"
      ?isWatchedRealRecord(row):row.status===filterStatus))&&
    (!filterCity||row.city===filterCity)&&
    (!filterYear||row.date.startsWith(filterYear))&&
    (!favoritesOnly||row.favorite)
  ).sort((a,b)=>{
    if(sortMode==="edited")return b.updatedAt.localeCompare(a.updatedAt)||b.date.localeCompare(a.date);
    return sortMode==="newest"?b.date.localeCompare(a.date):a.date.localeCompare(b.date);
  }),[model.records,filterStatus,filterCity,filterYear,favoritesOnly,sortMode]);
  const filterApplied=filterStatus!=="all"||Boolean(filterCity||filterYear||favoritesOnly||search.trim());
  const clearArchiveFilters=()=>{
    setSearch("");setFilterStatus("all");setFilterCity("");setFilterYear("");
    setFavoritesOnly(false);setSortMode("newest");
  };
  const visibleModel=useMemo(()=>describeRealArchive(active),[active]);
  const firstPosters=useMemo(()=>curateFeaturedRecords(
    describeRealArchive(records).records, record=>Boolean(primaryMedia(record, ["poster"])),5,
  ),[records]);
  useEffect(()=>{
    let alive=true;
    const scope=currentStorageScope();
    setPosters(firstPosters.map(record=>({id:record.id,title:record.title,city:record.city})));
    void Promise.all(firstPosters.map(async record=>{
      const asset=primaryMedia(record, ["poster"]) as MediaAsset;
      const src=await resolveMediaSource(asset,true).catch(()=>"");
      return {id:record.id,title:record.title,city:record.city,src};
    })).then(rows=>{
      if(alive && currentStorageScope()===scope)setPosters(rows);
    });
    return ()=>{alive=false;};
  },[firstPosters]);
  const selected=records.find(row=>row.id===selectedId);
  // The only permitted V3 write before cloud cutover is to the explicit
  // standalone local device archive. Authenticated V2 users remain read-only.
  const canEditLocal=validScope && access.mode==="device" && actualScope==="device-local";
  const canEditAccount=validScope && access.mode==="account" &&
    actualScope===cloudMode.scope && cloudMode.mode==="v3";
  // V2 is still the sole account cloud writer. Its authenticated account may
  // edit the same *local* scoped draft through the V3 UI. This is not a V3
  // writer cutover and never initiates V3 cloud writes.
  const canEditLegacyAccount=validScope && access.mode==="account" &&
    actualScope===cloudMode.scope && cloudMode.mode==="v2" && !cloudMode.error;
  const canEdit=canEditLocal || canEditAccount || canEditLegacyAccount;
  const requireAuthorizedWriter=async (scope:string)=>{
    if(currentStorageScope()!==scope)throw Error("V3_ACCOUNT_SESSION_CHANGED");
    if(canEditAccount || canEditLegacyAccount){
      const active=accountRuntime.current;
      if(!active||active.scope!==scope)throw Error("V3_WRITER_AUTH_REQUIRED");
      const serverMode=await active.runtime.writerMode();
      if(serverMode!==(canEditAccount?"v3":"v2"))
        throw Error("V3_WRITER_MODE_CHANGED");
    }else if(!canEditLocal){
      throw Error("V3_WRITER_NOT_ACTIVE");
    }
    if(currentStorageScope()!==scope)throw Error("V3_ACCOUNT_SESSION_CHANGED");
  };
  const startEdit=(record:EventRecord|null)=>{
    if(!canEdit) return;
    setEditing({draft:record??blankRecord(),baseline:record??null,scope:actualScope});
    setSelectedId(null);
  };

  const requestDuplicate=(record:EventRecord)=>{
    if(!canEdit){setNotice("当前账号保持 V2 写入模式，V3 不会创建重复记录。");return;}
    setEditing({draft:duplicateRecordForNextShow(record),baseline:null,scope:actualScope});
    setSelectedId(null);
  };
  const trashRecord=async(record:EventRecord)=>{
    if(!canEdit || currentStorageScope()!==actualScope)throw Error("V3_ACCOUNT_WRITER_NOT_ACTIVE");
    await requireAuthorizedWriter(actualScope);
    const timestamp=new Date().toISOString();
    const result=await saveRecordDraft(new IndexedDbRecordRepository(actualScope),
      {...record,deletedAt:timestamp,updatedAt:timestamp},record);
    if(result.status!=="saved")throw Error("V3_RECORD_EDITED_ELSEWHERE");
    if(currentStorageScope()!==actualScope)throw Error("V3_ACCOUNT_SESSION_CHANGED");
    setSelectedId(null);
    setNotice("已移入本机回收站，原图未删除。进入「更多 → 数据与备份 → 回收站」可找回；账号云端仍须安全同步。");
    setReload(n=>n+1);
  };

  const restoreTrashedRecord=async(record:EventRecord)=>{
    if(!canEdit || !record.deletedAt || restoreBusy)return;
    const scope=currentStorageScope();
    setRestoreBusy(true);
    try{
      if(scope!==actualScope)throw Error("V3_RESTORE_ACCOUNT_CHANGED");
      await requireAuthorizedWriter(scope);
      const timestamp=new Date().toISOString();
      const result=await saveRecordDraft(new IndexedDbRecordRepository(scope),
        {...record,deletedAt:undefined,updatedAt:timestamp},record);
      if(result.status!=="saved")throw Error("V3_RECORD_EDITED_ELSEWHERE");
      if(currentStorageScope()!==scope)throw Error("V3_RESTORE_ACCOUNT_CHANGED");
      setNotice("已从本机回收站恢复「"+record.title+"」，原图引用不变；账号云端仍需另行安全同步。");
      setReload(n=>n+1);
    }catch(error){
      setNotice("恢复未完成；原记录仍保留在回收站，请刷新检查版本后重试。"+
        (error instanceof Error?" "+error.message:""));
    }finally{setRestoreBusy(false);}
  };

  const saveLocalDraft=async (draft:EventRecord)=>{
    const stageAllowed=validScope&&access.mode==="account";
    if((!canEdit&&!stageAllowed)||!editing||
        editing.scope!==currentStorageScope()) {
      throw new Error("账号作用域已更改；未保存任何记录");
    }
    // Never treat an offline/unauthorized account edit as a formal V3 write.
    // Stage its full record (including local image bytes) in a separate
    // private IndexedDB store so it survives closing the browser.
    let writerApproved=false;
    if(canEdit){
      try { await requireAuthorizedWriter(editing.scope); writerApproved=true; }
      catch(error) { if(!stageAllowed) throw error; }
    }
    if(!writerApproved){
      if(!stageAllowed||currentStorageScope()!==editing.scope)
        throw new Error("V3_PENDING_SCOPE_CHANGED");
      await stagePendingEditor(editing.scope,draft,editing.baseline);
      setEditing(null);
      setNotice("已保存为账号专属的本机待提交草稿（含图片）；" +
        "尚未写入正式档案或云端。联网后在「数据 → 待提交草稿」继续编辑并提交。");
      setReload(n=>n+1);
      return;
    }
    const result=await saveRecordDraft(new IndexedDbRecordRepository(editing.scope),draft,editing.baseline);
    if(result.status==="review-required") {
      throw new Error("另一标签页已修改此记录。当前草稿保持打开；请复制修改内容并重新载入最新档案核对。");
    }
    if(currentStorageScope()!==editing.scope) throw new Error("保存期间账号已切换，请重新核查档案");
    try { await removePendingEditor(editing.scope,draft.id); }
    catch { /* Official CAS succeeded; never undo an accepted local save. */ }
    setEditing(null);
    setTransferApproval(null);
    setNotice(canEditAccount
      ? "本机已原子保存；点击“安全同步”才会传输至已切换的账号云端。"
      : canEditLegacyAccount
        ? "已安全保存到当前账号的本机 V2 档案；云端 V2 尚未同步，原图未删除。"
        : "已安全保存至此设备；尚未启用云同步");
    setReload(n=>n+1);
  };


  const saveImportedRecord=async(record:EventRecord)=>{
    const scope=currentStorageScope();
    if(!canEdit || !importOpen || !scope || scope!==actualScope)
      throw Error("V3_IMPORT_WRITER_NOT_ACTIVE");
    // The client-side UI permission alone is not a writer fence. A fresh
    // authenticated server marker is mandatory for EACH account write.
    if(!canEditLocal && !canEditAccount && !canEditLegacyAccount)
      throw Error("V3_IMPORT_SCOPE_NOT_ALLOWED");
    await requireAuthorizedWriter(scope);
    if(currentStorageScope()!==scope)throw Error("V3_IMPORT_ACCOUNT_CHANGED");
    const result=await saveRecordDraft(new IndexedDbRecordRepository(scope),record,null);
    if(result.status!=="saved")throw Error("V3_IMPORT_RECORD_ID_CONFLICT");
    if(currentStorageScope()!==scope)throw Error("V3_IMPORT_ACCOUNT_CHANGED");
    setTransferApproval(null);
    // Imported media is local until the user explicitly triggers authorized
    // CAS synchronization. No V2 upload, no silent account-cloud writer.
  };

  const exportAndroidConcertReminders=async()=>{
    if(!canEditLocal||snapshot.busy)return;
    const scope=currentStorageScope();
    try{
      const {downloadBlob}=await import("../../media");
      const originals=await listRecords();
      if(scope!==currentStorageScope())throw Error("V3_ANDROID_EXPORT_ACCOUNT_CHANGED");
      const shows=originals.filter(r=>
        !r.deletedAt&&r.status==="planned"&&r.recordState==="normal"&&
        /^\\d{4}-\\d{2}-\\d{2}$/.test(r.date||"")&&
        typeof r.id==="string"&&typeof r.title==="string"
      ).map(r=>({
        schemaVersion:2,id:r.id,title:r.title,status:r.status,
        recordState:r.recordState,date:r.date,time:r.time||"",
        venue:r.venue||"",seat:r.seat||"",
        media:[],
      }));
      if(!shows.length){
        setNotice("本机没有待看演出可供导出；如云端有最新演出，请先安全同步并刷新。");
        return;
      }
      const payload={app:"live-memory",version:3,
        purpose:"android-concert-reminders",source:"current-local-v3",
        generatedAt:new Date().toISOString(),records:shows};
      if(scope!==currentStorageScope())throw Error("V3_ANDROID_EXPORT_ACCOUNT_CHANGED");
      downloadBlob(JSON.stringify(payload),
        "live-memory-android-reminders-"+new Date().toISOString().slice(0,10)+".json",
        "application/json");
      setNotice(`已导出 ${shows.length} 场本机待看演出的时间、场馆及座位；不含票根、图片、金额、账号令牌。可在 Qi-Ledger Android 的「提醒与通知」中导入。`);
    }catch(error){
      setNotice("未完成安卓演出提醒导出，档案未改变。"+
        (error instanceof Error?error.message:""));
    }
  };

  const exportVerifiedLocalBackup=async()=>{
    if(!canEditLocal||exportBusy)return;
    const scope=currentStorageScope();
    const assertScope=()=>{
      if(currentStorageScope()!==scope)throw Error("V3_BACKUP_ACCOUNT_CHANGED");
    };
    setExportBusy(true);
    try{
      const {createPortableBackup,verifyPortableBackupDocument}=
        await import("../../core/application/portableMediaBackup");
      const {readAsDataUrl,downloadBlob}=await import("../../media");
      const {stableSerialize}=await import("../../core/sync/revision");
      assertScope();
      const original=await listRecords();
      assertScope();
      if(!original.length)throw Error("V3_BACKUP_EMPTY_LOCAL_ARCHIVE");
      const archive=await createPortableBackup(original,{
        assertScope,
        async load(asset){
          assertScope();
          const src=await resolveMediaSource(asset,true);
          assertScope();
          if(!src)throw Error("V3_BACKUP_MEDIA_UNAVAILABLE");
          const response=await fetch(src,{mode:"cors",credentials:"omit"});
          assertScope();
          if(!response.ok||response.type==="opaque")
            throw Error("V3_BACKUP_MEDIA_UNAVAILABLE");
          return response.blob();
        },
        encode:readAsDataUrl,
      });
      assertScope();
      const proof=await verifyPortableBackupDocument(archive);
      assertScope();
      const live=await listRecords();
      const baseline=new Map(original.map(row=>[row.id,stableSerialize(row)]));
      if(live.length!==original.length||baseline.size!==original.length||
        live.some(row=>baseline.get(row.id)!==stableSerialize(row)))
        throw Error("V3_BACKUP_LOCAL_CHANGED");
      assertScope();
      downloadBlob(JSON.stringify(archive),
        "live-memory-v3-local-"+new Date().toISOString().slice(0,10)+".json",
        "application/json");
      setNotice(`已请求下载本机可恢复备份：${proof.records} 条记录、${proof.assets} 个原图文件，原图总计 ${proof.totalBytes} 字节。请独立保存并用恢复入口验证；此文件不包含其他设备的云端独有记录。`);
    }catch(error){
      setNotice("未生成完整本机备份：原图字节缺失、文件超限或导出期间记录变化。未更改任何数据。"+
        (error instanceof Error?error.message:""));
    }finally{setExportBusy(false);}
  };

  const inspectRestore=async(file?:File)=>{
    if(!file||!canEdit||restoreBusy)return;
    const scope=currentStorageScope();
    setRestoreBusy(true);setRestorePreview(null);
    try{
      if(file.size>400*1024*1024)throw Error("V3_RESTORE_FILE_TOO_LARGE");
      const parsed:unknown=JSON.parse(await file.text());
      if(currentStorageScope()!==scope)throw Error("V3_RESTORE_ACCOUNT_CHANGED");
      const {verifyPortableBackupDocument}=await import("../../core/application/portableMediaBackup");
      const {stableSerialize}=await import("../../core/sync/revision");
      const checked=await verifyPortableBackupDocument(parsed);
      if(currentStorageScope()!==scope)throw Error("V3_RESTORE_ACCOUNT_CHANGED");
      const rows=(parsed as {records:EventRecord[]}).records;
      // A restore must not silently modify fields or discard media while
      // normalizing an old archive. Request a fresh canonical export instead.
      if(rows.some(row=>stableSerialize(normalizeRecord(row))!==stableSerialize(row))){
        throw Error("V3_RESTORE_NONCANONICAL_BACKUP");
      }
      setRestorePreview({scope,name:file.name,document:parsed,
        records:checked.records,assets:checked.assets,bytes:checked.totalBytes});
      setNotice(`已校验备份：${checked.records} 条记录、${checked.assets} 个原始媒体文件；仅本机增量恢复，不覆盖已有 ID。确认前不会写入。`);
    }catch(error){
      setNotice("备份预检未通过（格式、原图 SHA-256 或规范化字段不一致）；没有写入任何记录。"+
        (error instanceof Error?" "+error.message:""));
    }finally{setRestoreBusy(false);}
  };
  const confirmRestore=async()=>{
    const preview=restorePreview;
    if(!preview||restoreBusy||!canEdit||preview.scope!==currentStorageScope())return;
    setRestoreBusy(true);
    try{
      if(canEditAccount){
        const active=accountRuntime.current;
        if(!active||active.scope!==preview.scope||await active.runtime.writerMode()!=="v3")
          throw Error("V3_ACCOUNT_WRITER_NOT_ACTIVE");
      }
      const {restoreVerifiedPortableArchive}=await import("../../core/application/restoreVerifiedPortableArchive");
      const result=await restoreVerifiedPortableArchive(preview.document,
        new IndexedDbRecordRepository(preview.scope),
        ()=>{if(currentStorageScope()!==preview.scope)throw Error("V3_RESTORE_ACCOUNT_CHANGED");});
      setRestorePreview(null);
      setNotice(`已在单个本机事务中安全新增 ${result.inserted} 条、原样保留 ${result.alreadyPresent} 条；新增媒体回读核验 ${result.verifiedAssets} 项、${result.verifiedBytes} 字节。未启动云端写入。`);
      setReload(n=>n+1);
    }catch(error){
      const reason=error instanceof Error?error.message:"";
      setRestorePreview(null);
      setNotice("恢复未取得完整验收：未覆盖、清空或删除现有档案。如事务已提交但后续回读失败，已新增记录仍保留，需重新核验。"+reason);
    }finally{setRestoreBusy(false);}
  };

  const rescueCdnMediaManually=async()=>{
    const scoped=accountRuntime.current;
    if(!canEditAccount || syncBusy || !scoped ||
      scoped.scope!==currentStorageScope())return;
    setSyncBusy(true);
    try{
      const {rescueHistoricalCdnOriginals}=await import(
        "../../infrastructure/supabase/rescueHistoricalCdnOriginals"
      );
      const report=await rescueHistoricalCdnOriginals(scoped.scope,
        ()=>currentStorageScope()===scoped.scope);
      if(currentStorageScope()!==scoped.scope)throw Error("V3_RESCUE_ACCOUNT_CHANGED");
      // A cloud CAS successful recovery is NOT a local-sync acknowledgement.
      // Never auto-merge an old local browser record after a cloud-side image
      // rewrite: the user can safely review before synchronizing.
      const names:Record<string,string>={
        CDN_FORBIDDEN:"原网站拒绝访问",CDN_NOT_FOUND:"原网站图片已失效",
        CDN_RATE_LIMITED:"原网站限流",CDN_SERVER_ERROR:"原网站故障",
        CDN_DOWNLOAD_UNAVAILABLE:"下载不可用",CDN_TIMEOUT:"下载超时",
        CDN_IMAGE_TOO_LARGE:"原图超出限制",
        CDN_EMPTY_OR_INVALID_IMAGE:"原图为空或无效",
        CDN_NOT_A_SUPPORTED_IMAGE:"图片格式不受支持",
        CDN_MISSING_BODY:"原站未提供图片",
        UNTRUSTED_SOURCE:"来源不符合白名单",
        PRIVATE_UPLOAD_FAILED:"私有存储上传失败",
        PRIVATE_IMAGE_HASH_MISMATCH:"私有存储校验失败",
        V3_REVISION_CONFLICT_OR_CAS_FAILED:"账号云端记录已更新",
        UNKNOWN_FAILURE:"其他失败",
      };
      const reasons=Object.entries(report.failureReasons).map(([key,count])=>
        (names[key]||"其他失败")+count+" 项").join("；");
      setNotice(`历史原图补全：实际私有化复制 ${report.recovered} 项，
        原图暂不可取回 ${report.failed} 项，仍有外链 ${report.remaining} 项。
        ${reasons?"失败分类："+reasons+"。":""}
        ${report.recovered?"云端媒体引用已经更新；请先核对差异，再点击安全同步。":
          "云端记录未被替换。若一直失败，请保存原网站可见图片后从编辑器人工补图。"}`);
      if(report.recovered)setReload(n=>n+1);
    }catch(error){
      setNotice("私有化补图检查失败，原链接及账号记录均保留。"+
        (error instanceof Error?" "+error.message:""));
    }finally{setSyncBusy(false);}
  };

  const inspectSyncDifferences=async()=>{
    const scoped=accountRuntime.current;
    if(!canEditAccount||!scoped||syncBusy)return;
    const scope=scoped.scope;
    setSyncBusy(true);
    try{
      const audit=await scoped.runtime.audit();
      const details=await scoped.runtime.review();
      if(currentStorageScope()!==scope)throw Error("V3_REVIEW_ACCOUNT_CHANGED");
      setSyncReview({scope,checked:audit.checkedRecords,
        unresolved:audit.unresolved,details});
      setNotice(audit.unresolved
        ? "已列出需要人工核对的记录与字段；没有替您决定任何一方优先。"
        : "云端差异核对完成。无双端分歧，仍须安全同步才能传输更改。");
    }catch{
      setNotice("无法读取当前账号的差异清单；本机记录未改变。请检查登录和网络。");
    }finally{setSyncBusy(false);}
  };

  const inspectSpecificConflict=async(id:string)=>{
    const scoped=accountRuntime.current;
    if(!canEditAccount||!scoped||syncBusy||scoped.scope!==currentStorageScope())return;
    setSyncBusy(true);
    try{
      const entry=await scoped.runtime.previewConflict(id);
      if(currentStorageScope()!==scoped.scope)throw Error("V3_CONFLICT_ACCOUNT_CHANGED");
      setConflictPreview({scope:scoped.scope,entry});
      setNotice("已加载两份真实版本的字段对照。请逐项核对后手动选择；未改动正式数据。");
    }catch(error){
      setConflictPreview(null);
      setNotice("无法验证当前冲突版本，请重新检查账号及网络。"+
        (error instanceof Error?" "+error.message:""));
    }finally{setSyncBusy(false);}
  };

  const confirmSpecificConflict=async(choice:"keep-local"|"keep-cloud")=>{
    const scoped=accountRuntime.current;
    const preview=conflictPreview;
    if(!canEditAccount||!scoped||!preview||syncBusy||
      scoped.scope!==preview.scope||currentStorageScope()!==preview.scope)return;
    const label=choice==="keep-local"?"保留本机":"保留云端";
    if(!window.confirm("确定"+label+"版本？另一份记录（含可取回的图片字节）必须先完整保存到本机保护区。" +
      "遇到原图缺失、版本变化、空间不足会自动中止，不会静默丢弃。"))return;
    setSyncBusy(true);
    try{
      const result=await scoped.runtime.resolveConflict(preview.entry,choice);
      if(currentStorageScope()!==preview.scope)throw Error("V3_CONFLICT_ACCOUNT_CHANGED");
      setConflictPreview(null);
      setSyncReview(null);
      const kept=await listProtectedConflictVersions(preview.scope);
      if(currentStorageScope()===preview.scope)setProtectedVersions(kept);
      setNotice(result.deferred
        ? "已保留冲突版本，但另一标签页可能有新修改。请重新检查再同步；保护副本可导出。"
        : "已按明确选择处理冲突；另一方版本与可获得的图片字节已保存到本机保护区。可导出保护副本。");
      setReload(n=>n+1);
    }catch(error){
      setConflictPreview(null);
      setNotice("冲突选择未完成；原有双端记录保留，可能已有本机保护副本。请重新检查差异。"+
        (error instanceof Error?" "+error.message:""));
    }finally{setSyncBusy(false);}
  };

  const exportProtectedConflict=async(key:string)=>{
    const scope=currentStorageScope();
    // Export is read-only and remains available when the cloud is offline
    // or the server has reverted to its legacy writer mode.
    if(syncBusy||!validScope||access.mode!=="account"||!scope)return;
    setSyncBusy(true);
    try{
      const backup=await readProtectedConflictVersion(scope,key);
      if(!backup)throw Error("V3_PROTECTED_VERSION_NOT_FOUND");
      const {createPortableBackup,verifyPortableBackupDocument}=
        await import("../../core/application/portableMediaBackup");
      const {readAsDataUrl,downloadBlob}=await import("../../media");
      const assets=new Map(backup.assets.map(item=>[item.id,item.bytes]));
      const archive=await createPortableBackup([backup.record],{
        assertScope(){
          if(currentStorageScope()!==scope)throw Error("V3_CONFLICT_ACCOUNT_CHANGED");
        },
        async load(asset){
          const bytes=assets.get(asset.id);
          if(!bytes)throw Error("V3_PROTECTED_IMAGE_MISSING");
          return bytes;
        },
        encode:readAsDataUrl,
      });
      const checked=await verifyPortableBackupDocument(archive);
      if(currentStorageScope()!==scope)throw Error("V3_CONFLICT_ACCOUNT_CHANGED");
      downloadBlob(JSON.stringify(archive),
        "live-memory-protected-"+backup.recordId+"-"+backup.savedAt.slice(0,10)+".json",
        "application/json");
      setNotice("已请求下载保护副本，内含 "+checked.records+" 条记录与 "+
        checked.assets+" 张可验证图片；文件可离线保存。已有相同 ID 的正式档案不会被恢复入口覆盖。");
    }catch(error){
      setNotice("保护副本导出失败，原本机保护区仍保留。"+
        (error instanceof Error?" "+error.message:""));
    }finally{setSyncBusy(false);}
  };

  const restoreProtectedAsPending=async(key:string)=>{
    const scope=currentStorageScope();
    if(syncBusy||!validScope||access.mode!=="account"||!scope)return;
    if(!window.confirm("将保护副本另存为新的本机待提交草稿？"+
      "正式记录和云端内容完全不变；图片将以已保护的实际字节重新附加。"))return;
    setSyncBusy(true);
    try{
      const protectedRow=await readProtectedConflictVersion(scope,key);
      if(!protectedRow)throw Error("V3_PROTECTED_VERSION_NOT_FOUND");
      const {readAsDataUrl}=await import("../../media");
      const newId=createId("record");
      const now=new Date().toISOString();
      const blobs=new Map(protectedRow.assets.map(item=>[item.id,item.bytes]));
      if(blobs.size!==protectedRow.record.media.length)
        throw Error("V3_PROTECTED_IMAGE_INCOMPLETE");
      const media=await Promise.all(protectedRow.record.media.map(async asset=>{
        const bytes=blobs.get(asset.id);
        if(!bytes?.size)throw Error("V3_PROTECTED_IMAGE_MISSING");
        const src=await readAsDataUrl(bytes);
        if(currentStorageScope()!==scope)throw Error("V3_CONFLICT_ACCOUNT_CHANGED");
        return {...asset,id:createId("media"),recordId:newId,
          storagePath:undefined,src,source:"local" as const,
          mimeType:bytes.type||asset.mimeType,size:bytes.size,
          createdAt:now,updatedAt:now};
      }));
      if(currentStorageScope()!==scope)throw Error("V3_CONFLICT_ACCOUNT_CHANGED");
      const draft:EventRecord={
        ...protectedRow.record,
        id:newId,title:protectedRow.record.title+"（找回副本）",
        media,mediaTombstones:[],deletedAt:undefined,syncedAt:undefined,
        createdAt:now,updatedAt:now,
      };
      await stagePendingEditor(scope,draft,null);
      if(currentStorageScope()!==scope)throw Error("V3_CONFLICT_ACCOUNT_CHANGED");
      setNotice("已将保护副本完整另存为本机待提交草稿（含图片），"+
        "正式档案和云端版本均未覆盖。请在上方待提交草稿核对后自行保存。");
      setReload(n=>n+1);
    }catch(error){
      setNotice("恢复为草稿未完成，原保护副本保持不变。"+
        (error instanceof Error?" "+error.message:""));
    }finally{setSyncBusy(false);}
  };

  const safeSync=async()=>{
    if(!canEditAccount||syncBusy)return;
    const scoped=accountRuntime.current;
    if(!scoped||scoped.scope!==currentStorageScope())return;
    setSyncBusy(true);
    try{
      if(await scoped.runtime.writerMode()!=="v3"||currentStorageScope()!==scoped.scope)
        throw Error("V3_ACCOUNT_WRITER_NOT_ACTIVE");
      const audit=await scoped.runtime.audit();
      if(audit.requiresMigrationReview){
        setTransferApproval(null);
        setNotice("检测到历史记录分歧或缺失，已停止同步。请在 V2 设置中查看迁移差异并解决冲突。");
        return;
      }
      const push=audit.actions["push-new"],pull=audit.actions["pull-new"];
      // Once a revision was safely acknowledged in this exact account,
      // subsequent new events are ordinary sync, not a repeated migration.
      const alreadySynchronized=await scoped.runtime.hasAcknowledgedBaseline();
      if((push||pull)&&!alreadySynchronized&&(!transferApproval||
          transferApproval.scope!==scoped.scope||
          transferApproval.push!==push||transferApproval.pull!==pull)){
        setTransferApproval({scope:scoped.scope,push,pull});
        setNotice(`首次接入该账号预计上传本机新增 ${push} 条、下载云端新增 ${pull} 条。
          请检查数量，再点击一次“安全同步”以确认；不会覆盖不同内容的历史记录。`);
        return;
      }
      const result=await scoped.runtime.synchronize({
        v2AutoSyncDisabled:true, initialTransferApproved:push+pull>0,
      });
      if(currentStorageScope()!==scoped.scope)throw Error("V3_ACCOUNT_SESSION_CHANGED");
      setTransferApproval(null);
      setNotice(`同步完成：上传 ${result.uploadedIds.length} 条、
        下载 ${result.downloadedIds.length} 条，待重试 ${result.deferredIds.length} 条。`);
      setReload(n=>n+1);
    }catch(error){
      const reason=error instanceof Error?error.message:"";
      setNotice(reason.includes("V3_SYNC_MIGRATION_REVIEW_REQUIRED")
        ? "云端或本机存在需要审查的历史差异；没有进行覆盖式同步。"
        : "同步未完成：身份变化、网络故障或云端版本冲突。已保留本机记录，请重新检查。");
    }finally{setSyncBusy(false);}
  };
  // One continuous scroll contains every filtered record; images load lazily.
  const yearGroups=useMemo(()=>{
    const groups=new Map<string,EventRecord[]>();
    for(const row of active){
      const year=/^\d{4}/.test(row.date)?row.date.slice(0,4):"日期待补";
      groups.set(year,[...(groups.get(year)||[]),row]);
    }
    return [...groups.entries()];
  },[active]);
  const navButtons=navigation.map(label=><button type="button" key={label}
    aria-current={page===label?"page":undefined} onClick={()=>setPage(label)}>{label}</button>);
  return <WorkspaceShell
    brand={<><span className="v3-preview-brand"><BrandMark size={36} title="Live Memory 标识" /></span>
      <strong className="v3-preview-brand-name">Live Memory</strong>
      <small>V3 · 现场记忆</small></>}
    navigation={navButtons}
    mobileNavigation={navButtons}
    appearance="liquid"
    demoStatus={false}
    showStatusCenter={false}
    activity={{type:"idle"}}
    toolbar={<div className="v3-real-topbar">
      <div><span>LIVE MEMORY · YOUR ARCHIVE</span>
        <strong>{page==="档案"?"演出档案":page==="数据"?"数据与备份":page}</strong>
        <small>{canEditLocal?"本机档案可编辑"
          : canEditAccount?"当前账户 · 云端同步可用"
          : canEditLegacyAccount?"当前账户 · 本机修改待同步"
          : "正在连接你的档案"}</small></div>
      <div className="v3-real-topbar-stats"><b>{active.length}<small>档案</small></b>
        <b>{visibleModel.watchedCount}<small>已看</small></b>
        <b>{visibleModel.cities.length}<small>城市</small></b></div>
      <div className="v3-real-topbar-actions" aria-label="档案操作">
        {canEdit && <button className="v3-real-action-primary" type="button" onClick={()=>startEdit(null)}>
          {canEditLocal?"新增本机演出":"新增演出"}</button>}
        {canEditAccount && <button className="v3-real-sync-trigger" type="button" onClick={()=>void safeSync()} disabled={syncBusy||snapshot.busy}>
          {syncBusy?"安全检查与同步中…":"安全同步"}</button>}
        <button type="button" onClick={()=>{setShareRecord(null);setSharing(true);}}
          disabled={!records.length}>制作分享图</button>
        {canEdit && <button type="button" onClick={()=>setImportOpen(true)}
          disabled={snapshot.busy||syncBusy||restoreBusy}>批量导入</button>}
        {canEditLocal && <button type="button" onClick={()=>void exportVerifiedLocalBackup()}
          disabled={exportBusy||restoreBusy||snapshot.busy}>
          {exportBusy?"完整原图备份中…":"导出可恢复本机备份"}</button>}
        <button type="button" onClick={()=>setReload(n=>n+1)}
          disabled={snapshot.busy||syncBusy}>刷新</button>
        <details className="v3-real-more-tools">
          <summary aria-label="更多工具">更多</summary>
          <div className="v3-real-more-menu">
            <button type="button" onClick={event=>{
              event.currentTarget.closest("details")?.removeAttribute("open");
              setPage("数据");
            }}>数据与备份</button>
          </div>
        </details>
      </div>
    </div>}
    overlay={importOpen && canEdit
      ? <ImportDrawer
          onClose={()=>{
            setImportOpen(false);
            setReload(n=>n+1);
          }}
          onSave={saveImportedRecord}
          flash={message=>setNotice(message+" · 当前仅保存本机；云端同步需另行确认。")}/>
      : deleteCandidate
      ? <ConfirmDialog action={{
          title:"将演出移入回收站",message:"只标记删除此演出；不删除原图，保留版本冲突保护。",
          confirmLabel:"确认移入回收站",danger:true,
          onConfirm:()=>trashRecord(deleteCandidate),
        }} onClose={()=>setDeleteCandidate(null)}/>
      : zoomMedia
        ? <ImageZoom media={zoomMedia} onClose={()=>setZoomMedia(null)}/>
      : sharing
      ? <ShareStudio experience="v3" records={shareRecord?[shareRecord]:(page==="档案"?active:records)} format={shareFormat} setFormat={setShareFormat}
          mapSettings={readSettings().map}
          onOpenMapSettings={()=>{
            setSharing(false);
            setNotice("地图密钥尚未在 V3 中单独配置；请先在 V2 设置页配置，再返回 V3 分享。");
          }}
          onClose={()=>{setSharing(false);setShareRecord(null);}}/>
      : editing && editing.scope===actualScope &&
        (canEdit || (validScope && access.mode==="account"))
      ? <RecordEditor record={editing.draft} cloudMediaSyncEnabled={false}
          onCancel={()=>setEditing(null)} onSave={saveLocalDraft}/>
      : selected
        ? <RecordDetail record={selected} onClose={()=>setSelectedId(null)}
            onEdit={canEdit?startEdit:undefined}
            onDuplicate={canEdit?requestDuplicate:undefined}
            onTrash={canEdit?setDeleteCandidate:undefined}
            onShare={record=>{setShareRecord(record);setSelectedId(null);setSharing(true);}}
            onZoom={setZoomMedia}/>
        : undefined}
  >
    {import.meta.env.VITE_V3_BETA==="1" && <aside role="note" className="v3-real-save-notice">
      {import.meta.env.VITE_V3_BETA_BASE==="pages"
        ? "此试用页与正式 V2 共用域名和本机存储；本机模式编辑可能同步体现在 V2。请先导出可恢复备份。"
        : "此试用站使用独立域名，旧 V2 本机数据不会自动跨域出现；可从 V2 导出后在此导入。"}
      账号模式仍以 V2 为写入端时，此处只读；试用页不代表正式切换。
    </aside>}
    {cloudMode.error && access.mode==="account" && <div role="alert" className="v3-real-save-notice">{cloudMode.error}</div>}
    {notice && <div className="v3-real-save-notice" role="status">{notice}
      <button type="button" onClick={()=>setNotice("")} aria-label="关闭提示">×</button></div>}
    {!validScope || snapshot.error ? <section className="v3-real-panel" role="alert">
      <h2>无法读取当前档案</h2><p>{snapshot.error||"当前未登录私有账号。"}</p>
      <button type="button" onClick={backToV2}>切换至经典版 V2（编辑与同步）</button>
    </section> : snapshot.busy ? <section className="v3-real-panel" role="status">正在读取当前设备的档案快照…</section> :
    <>
      {page==="档案" && <>
        {firstPosters.length>0 && <V3FeaturedHero posters={posters} frameRatio={frameRatio}
          onNaturalRatio={measurePoster} onBrowse={()=>
          document.getElementById("v3-real-archive-controls")?.scrollIntoView({behavior:"smooth",block:"start"})}/>}
        <div id="v3-real-archive-controls" className="v3-real-archive-controls">
          <ActionToolbar
            search={<input aria-label="搜索真实档案" value={search}
              placeholder="搜索演出、艺人、城市、场馆…" onChange={event=>setSearch(event.target.value)}/>}
            modes={archiveModes.map(item=><button type="button" key={item}
              aria-pressed={mode===item} onClick={()=>setMode(item)}>{item}</button>)}
            actions={<select className="v3-real-extra-views" aria-label="更多档案视图"
              value={collectionModes.includes(mode as CollectionMode)?mode:""}
              onChange={event=>setMode(event.target.value as Mode)}>
              <option value="">更多视图</option>
              {collectionModes.map(label=>
                <option key={label} value={label}>{label}</option>)}
            </select>}/>
        </div>
        <div className="v3-real-refine-bar" aria-label="档案筛选和排序">
          <label>状态<select aria-label="按观演状态筛选" value={filterStatus}
            onChange={e=>setFilterStatus(e.target.value as typeof filterStatus)}>
            <option value="all">全部状态</option><option value="watched">已看</option>
            <option value="planned">待看</option><option value="wish">想看</option>
          </select></label>
          <label>年份<select aria-label="按年份筛选" value={filterYear}
            onChange={e=>setFilterYear(e.target.value)}>
            <option value="">全部年份</option>
            {facets.years.map(year=><option key={year} value={year}>{year}</option>)}
          </select></label>
          <label>城市<select aria-label="按城市筛选" value={filterCity}
            onChange={e=>setFilterCity(e.target.value)}>
            <option value="">全部城市</option>
            {facets.cities.map(city=><option key={city} value={city}>{city}</option>)}
          </select></label>
          <label>排序<select aria-label="档案排序" value={sortMode}
            onChange={e=>setSortMode(e.target.value as typeof sortMode)}>
            <option value="newest">时间最新</option><option value="oldest">时间最早</option>
            <option value="edited">最近编辑</option>
          </select></label>
          <button type="button" className={favoritesOnly?"is-active":""}
            aria-pressed={favoritesOnly} onClick={()=>setFavoritesOnly(v=>!v)}>
            {favoritesOnly?"♥ 已收藏":"♡ 仅收藏"}</button>
          {filterApplied&&<button type="button" className="v3-real-refine-clear"
            onClick={clearArchiveFilters}>清除筛选</button>}
          <span>{active.length} / {describeRealArchive(records).records.length} 场</span>
        </div>
        {!active.length?<div className="v3-real-panel"><h2>没有符合条件的记录</h2>
          <p>当前筛选下没有演出。</p><button type="button" onClick={clearArchiveFilters}>显示全部档案</button></div>:
        collectionModes.includes(mode as CollectionMode)?
          <V3ArchiveCollections mode={mode as CollectionMode} records={active}
            onOpen={setSelectedId}
            onEdit={canEdit?startEdit:undefined}
            onShare={record=>{setShareRecord(record);setSelectedId(null);setSharing(true);}}/>:
                mode==="海报"?<section className="v3-real-panel v3-real-gallery-panel">
          <header><span>LIVE MEMORY · ARCHIVE</span><h2>全部演出 <small>({active.length})</small></h2></header>
          <div className="v3-real-poster-grid">
            {active.map(record=><PosterCard key={record.id} record={record}
              onOpen={setSelectedId} onEdit={canEdit?startEdit:undefined}
              frameRatio={frameRatio} onNaturalRatio={measurePoster}/>)}
          </div></section>:
        mode==="时间线"?<section className="v3-real-panel v3-real-chronicle">
          <header><span>CHRONICLE · BY YEAR</span><h2>演出时间线</h2></header>
          {yearGroups.map(([year,rows])=><div className="v3-real-year-group" key={year}>
            <h3>{year}<small> · {rows.length} 场</small></h3>
            <div className="v3-real-timeline">
              {rows.map(row=><button type="button" key={row.id} onClick={()=>setSelectedId(row.id)}>
                <time>{row.date.slice(5)||row.date}</time>
                <strong>{row.title}</strong><small>{row.city} · {row.venue||"场馆待补"}</small>
              </button>)}
            </div>
          </div>)}
        </section>:
        <section className="v3-real-panel v3-real-index-panel">
          <header><span>ARCHIVE INDEX · ALL SHOWS</span><h2>演出索引</h2></header>
          <div className="v3-real-index-list">
            {active.map(record=><RecordIndexCard key={record.id} record={record}
              onOpen={setSelectedId} onEdit={canEdit?startEdit:undefined}
              frameRatio={frameRatio}/>)}
          </div>
        </section>}
      </>}
      {page==="统计" && <RealStatistics records={records}/>}
      {page==="数据" && <>
        {validScope&&access.mode==="account"&&<section className="v3-real-restore"
          aria-label="V3 离线待提交草稿">
          <strong>本机待提交草稿 · {pendingEditors.length} 条</strong>
          <p>断网或云端写入权限未确认时，编辑内容及补充的图片可先存于本机，
            不覆盖正式档案；重新联网并通过授权检查后再提交。</p>
          <button type="button" onClick={()=>{
            setEditing({draft:blankRecord(),baseline:null,scope:actualScope});
            setSelectedId(null);
          }}>新增本机待提交草稿</button>
          <button type="button" onClick={()=>setReload(n=>n+1)}>
            重新检查网络与账号写入权限
          </button>
          {pendingEditorsError&&<p role="alert">{pendingEditorsError}</p>}
          {pendingEditors.map(row=><div key={row.draft.id}>
            <strong>{row.draft.title}</strong>
            <span> · {row.draft.date||"日期待补"} · 图片 {row.draft.media.length} 项
              · 保存 {row.stagedAt.slice(0,16).replace("T"," ")}</span>
            <button type="button" onClick={()=>{
              setEditing({draft:row.draft,baseline:row.baseline,scope:actualScope});
              setSelectedId(null);
            }}>继续编辑／正式保存</button>
            <button type="button" onClick={()=>{
              if(!window.confirm("确认丢弃此条未提交的本机草稿及其临时图片吗？"))return;
              void removePendingEditor(actualScope,row.draft.id).then(()=>setReload(n=>n+1))
                .catch(()=>setPendingEditorsError("草稿删除失败，原内容仍保留。"));
            }}>丢弃草稿</button>
          </div>)}
        </section>}
        {canEditAccount&&<section className="v3-real-restore"
          aria-label="V3 历史外链原图补全">
          <strong>历史海报与座位图 · 私有化补全</strong>
          <p>只处理当前登录账号中仍指向大麦图片 CDN 的历史媒体。
            每项须真实下载图片、验证 SHA-256、写入私有存储并通过云端 CAS，
            否则保留原链接。不会触碰票根、其他账号或公开旧桶。</p>
          <button type="button" disabled={syncBusy}
            onClick={()=>void rescueCdnMediaManually()}>
            {syncBusy?"正在核验账号…":"检查并补全外链原图"}
          </button>
        </section>}
        {canEditAccount&&<section className="v3-real-restore" aria-label="V3 云端差异审阅">
          <strong>云端差异与冲突检查</strong>
          <p>在当前账号内对比本机记录、云端记录与上次确认版本。检查为只读；不会自动丢弃任何一方。</p>
          <button type="button" disabled={syncBusy}
            onClick={()=>void inspectSyncDifferences()}>
            {syncBusy?"正在检查…":"核对本机与云端差异"}
          </button>
          {conflictPreview?.scope===actualScope&&
            <div className="v3-real-restore-review" aria-label="V3 冲突版本对照">
              <strong>{conflictPreview.entry.title} · 双版本逐项核对</strong>
              <div className="v3-real-conflict-compare">
                {(["local","cloud"] as const).map(side=>{
                  const item=conflictPreview.entry[side];
                  return <article key={side}>
                    <strong>{side==="local"?"本机版本":"云端版本"}</strong>
                    <p>标题：{item.title}</p>
                    <p>日期：{item.date} · 城市：{item.city}</p>
                    <p>场馆：{item.venue} · 状态：{item.status}</p>
                    <p>图片：{item.mediaCount} 项 · 更新：{item.updatedAt}</p>
                    <p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>备注：{item.note||"无"}</p>
                  </article>;
                })}
              </div>
              <p>系统先将被舍弃版本及可取得的图片字节保存至本机保护区；
                必须校验云端版本号、当前账号与本机修订。任何步骤失败即停止覆盖。</p>
              <button type="button" disabled={syncBusy}
                onClick={()=>void confirmSpecificConflict("keep-local")}>
                明确保留本机版本
              </button>
              <button type="button" disabled={syncBusy}
                onClick={()=>void confirmSpecificConflict("keep-cloud")}>
                明确保留云端版本
              </button>
              <button type="button" disabled={syncBusy} onClick={()=>setConflictPreview(null)}>暂不处理</button>
            </div>}
          {syncReview?.scope===actualScope&&<>
            <p>核对 {syncReview.checked} 条记录；待人工确认 {syncReview.unresolved} 条；
              差异总数 {syncReview.details.total} 条。</p>
            {syncReview.details.items.map(item=><details key={item.id}>
              <summary><b>{item.title}</b> · {item.action==="conflict"?"双端并发修改":
                item.action==="unbased-divergence"?"历史版本不一致":
                item.action==="push-new"?"仅本机":item.action==="pull-new"?"仅云端":
                item.action==="push"?"本机改动":item.action==="pull"?"云端改动":"待核实"}</summary>
              <p>本机存在：{item.localPresent?"是":"否"} · 云端存在：{item.remotePresent?"是":"否"}</p>
              {item.differingFields.length>0&&<p>差异字段：{item.differingFields.join("、")}</p>}
              {(item.action==="conflict"||item.action==="unbased-divergence")&&
              <button type="button" disabled={syncBusy} onClick={()=>void inspectSpecificConflict(item.id)}>
                对照并选择版本
              </button>}
            {item.action==="defer-absence"&&
              <p>单端缺失可能是删除或清单不全，暂不推断或覆盖；请先核查缺失来源。</p>}
            </details>)}
            {syncReview.details.truncated&&<p>清单最多显示 100 条，需分批处理。</p>}
          </>}
        </section>}
        {validScope&&access.mode==="account"&&<section className="v3-real-restore"
          aria-label="V3 冲突保护副本">
          <strong>冲突保护副本 · {protectedVersions.length} 份</strong>
          <p>只有明确处理冲突后才会形成副本，实际图片字节独立存于当前浏览器；
            清理浏览器数据会丢失本机副本，请及时导出保存。</p>
          {protectedVersions.map(item=><div key={item.key}>
            <span><b>{item.title}</b> · 已保护{item.savedSide==="local"?"本机":"云端"}版本
              · {item.assets} 张图片 · {item.savedAt.slice(0,16).replace("T"," ")}</span>
            <button type="button" disabled={syncBusy}
              onClick={()=>void exportProtectedConflict(item.key)}>下载完整保护副本</button>
            <button type="button" disabled={syncBusy}
              onClick={()=>void restoreProtectedAsPending(item.key)}>找回为独立本机草稿</button>
          </div>)}
        </section>}
        <section className="v3-real-restore" aria-label="V3 回收站">
          <strong>回收站 · {trashedRecords.length} 条</strong>
          <p>已删除记录与媒体仍保留在当前档案；恢复先写回本机，账号档案需再点「安全同步」。</p>
          {trashedRecords.length===0?<p>回收站为空。</p>:
            <ul className="v3-real-trash-list">
              {trashedRecords.map(record=><li key={record.id}>
                <span><b>{record.title}</b> · {record.date} · 删除于 {record.deletedAt?.slice(0,10)}</span>
                <button type="button" disabled={!canEdit||restoreBusy} onClick={()=>void restoreTrashedRecord(record)}>
                  找回此记录
                </button>
              </li>)}
            </ul>}
        </section>
        <section className="v3-real-panel v3-real-data-heading">
          <header><span>DATA & BACKUP</span><h2>数据与备份</h2></header>
          <p>原始档案与图片始终保留。备份、恢复等操作仅在手动确认后执行。</p>
        </section>
        {canEditLocal&&<section className="v3-real-restore"
          aria-label="安卓演出提醒导出">
          <strong>导出安卓演出与座位提醒</strong>
          <p>从本机 V3 档案提取待看演出的准确日期、开演时间和座位，
            供 Qi-Ledger Android 离线设置提醒。只导出简短日程 JSON，
            不含票根原图、支付信息或云端凭据。导出前请核对已完成安全同步。</p>
          <button type="button" disabled={snapshot.busy||syncBusy}
            onClick={()=>void exportAndroidConcertReminders()}>
            下载安卓提醒日程 JSON
          </button>
        </section>}
        {(canEditLocal||canEditAccount) && <section className="v3-real-restore" aria-label="V3 完整备份恢复">
      <strong>完整档案备份恢复</strong>
      <p>仅接受已验证原图 SHA-256 的 V3 全量备份。先审查，再在一个本机事务中只新增、绝不覆盖或清空旧档案；云端同步需另行授权。</p>
      <input type="file" accept=".json,application/json" aria-label="选择 V3 原图完整备份"
        disabled={restoreBusy} onChange={event=>void inspectRestore(event.currentTarget.files?.[0])}/>
      {restorePreview&&restorePreview.scope===actualScope&&
        <div className="v3-real-restore-review">
          <span>{restorePreview.name} · {restorePreview.records} 条 · {restorePreview.assets} 份原图 · {restorePreview.bytes} 字节</span>
          <button type="button" disabled={restoreBusy} onClick={()=>void confirmRestore()}>
            {restoreBusy?"校验与恢复中…":"确认安全恢复到本机"}
          </button>
          <button type="button" disabled={restoreBusy} onClick={()=>setRestorePreview(null)}>取消</button>
        </div>}
    </section>}
        <section className="v3-real-advanced-data">
          <button type="button" aria-expanded={showLegacyDiagnostics}
            onClick={()=>setShowLegacyDiagnostics(open=>!open)}>
            旧版兼容与同步诊断（高级）{showLegacyDiagnostics?" · 收起":" · 展开"}
          </button>
          {showLegacyDiagnostics&&<>
            <p>仅在需要核查旧版数据或同步问题时使用；不会自动迁移或改写记录。</p>
            <button type="button" className="v3-real-classic-fallback" onClick={backToV2}>
              打开经典版 V2
            </button>
            {access.mode==="account" && validScope &&
              <V3MigrationPanel settings={readSettings()} records={records}
                personalConnected={hasPersonalCloudConnection(readSettings())}/>}
          </>}
        </section>
      </>}

      {page==="城市" && <RealCityView records={records} onOpen={setSelectedId}/>}
    </>}
  </WorkspaceShell>;
}
