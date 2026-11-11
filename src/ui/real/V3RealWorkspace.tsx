import { useEffect, useMemo, useRef, useState } from "react";
import { useAccess } from "../../access";
import type { EventRecord, MediaAsset } from "../../domain";
import { primaryMedia, mediaKindLabels, sourceLabels, statusLabels, categoryLabels } from "../../domain";
import { currentStorageScope, listRecords, normalizeRecord, readSettings } from "../../storage";
import type { V3SyncRuntime } from "../../infrastructure/createV3SyncRuntime";
import { resolveMediaSource, useCachedMediaSrc } from "../../mediaCache";
import { describeRealArchive, isWatchedRealRecord } from "../../core/application/describeRealArchive";
import { saveRecordDraft } from "../../core/application/saveRecordDraft";
import { IndexedDbRecordRepository } from "../../infrastructure/indexedDb/recordRepository";
import { RecordEditor } from "../../overlays";
import { blankRecord } from "../../seeds";
import { ShareStudio, type ShareFormat } from "../../shareStudio";
import { duplicateRecordForNextShow } from "../../recordActions";
import { hasPersonalCloudConnection } from "../../supabase";
import { ConfirmDialog, ImageZoom, ImportDrawer } from "../../overlays";
import { V3MigrationPanel } from "../system/V3MigrationPanel";
import { ActionToolbar, MapSplitPane, WorkspaceShell } from "../system/WorkspaceShell";
import { curateFeaturedRecords } from "./curateFeaturedRecords";
import { V3FeaturedHero } from "./V3FeaturedHero";
import { AdaptivePoster } from "./AdaptivePoster";
import { dominantPosterRatio } from "./posterFraming";
import { ArchivePage, type ArchiveLayout } from "../../archive";
import "../system/preview.css";
import "./realWorkspace.css";
import "./v3ShareStudio.css";
import "./adaptivePoster.css";
import "./v3ArchiveRefinements.css";

type Page = "档案" | "统计" | "城市" | "迁移";
type Mode = "海报" | "时间线" | "列表" | "画报" | "票夹" | "票根" |
  "日历" | "城市/场馆" | "票价" | "汇总";
const navigation: Page[] = ["档案", "统计", "城市", "迁移"];
const archiveModes: Mode[] = ["海报","时间线","列表"];
const advancedLayouts: Record<string,ArchiveLayout> = {
  "画报":"showcase","票夹":"wallet","票根":"ticket",
  "日历":"calendar","城市/场馆":"venue","票价":"price","汇总":"summary",
};

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
  const src=useCachedMediaSrc(primaryMedia(record));
  return <article className="v3-real-poster-card" data-record-id={record.id}>
    <button className="v3-real-poster-open" type="button" onClick={()=>onOpen(record.id)}
      aria-label={"查看 "+record.title}>
      <AdaptivePoster className="v3-real-poster-image" src={src}
        alt={record.title+"海报"} frameRatio={frameRatio}
        onNaturalRatio={ratio=>onNaturalRatio(record.id,ratio)}/>
      <strong title={record.title}>{record.title}</strong>
      <small>{record.date} · {record.city||"城市待补"}</small>
    </button>
    <div className="v3-real-card-actions">
      {onEdit&&<button type="button" onClick={()=>onEdit(record)} aria-label={"编辑 "+record.title}>编辑</button>}
      <button type="button" onClick={()=>onOpen(record.id)} aria-label={"更多详情 "+record.title}>详情</button>
    </div>
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
  const src=useCachedMediaSrc(primaryMedia(record));
  const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    closeRef.current?.focus();
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};
    document.addEventListener("keydown",onKey);
    return()=>document.removeEventListener("keydown",onKey);
  },[onClose]);
  return <div className="v3-real-modal-backdrop" role="presentation"
    onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="v3-real-modal v3-real-rich-detail" role="dialog"
      aria-modal="true" aria-label={record.title+"（档案详情）"}>
      <header>
        <div><small>LIVE MEMORY · EVENT ARCHIVE</small><h2>{record.title}</h2>
          <span>{record.date} · {record.city} · {record.venue}</span></div>
        <div className="v3-real-detail-header-actions">
          {onEdit&&<button type="button" aria-label="编辑本机演出"
            onClick={()=>onEdit(record)}>编辑</button>}
          <button type="button" aria-label="关闭档案详情" ref={closeRef} onClick={onClose}>×</button>
        </div>
      </header>
      <div className="v3-real-modal-body">
        <button className="v3-real-modal-art" type="button"
          onClick={()=>{const art=primaryMedia(record);if(art)onZoom(art);}}
          aria-label="放大主海报">
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
          {onTrash&&<button type="button" onClick={()=>onTrash(record)}>移入回收站</button>}
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
  const src=useCachedMediaSrc(primaryMedia(record));
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
      {selected.slice(0,25).map(row=><button type="button" key={row.id} onClick={()=>onOpen(row.id)}>
        <strong>{row.title}</strong><small>{row.date} · {row.venue}</small>
      </button>)}
      {selected.length>25&&<p>已展示前 25 场，可在档案中进一步检索。</p>}
    </div>}
  />;
}
export function V3RealWorkspace() {
  const access=useAccess();
  const [page,setPage]=useState<Page>("档案");
  const [mode,setMode]=useState<Mode>("海报");
  const [search,setSearch]=useState("");
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
  const [shareFormat,setShareFormat]=useState<ShareFormat>("adaptive-landscape");
  const [restoreBusy,setRestoreBusy]=useState(false);
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
  const [syncBusy,setSyncBusy]=useState(false);
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
        setCloudMode({scope,mode,error:""});
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
  const records=snapshot.scope===actualScope?snapshot.records:[];
  const frameRatio=useMemo(()=>dominantPosterRatio(Object.values(posterRatios)),
    [posterRatios]);
  const measurePoster=(id:string,ratio:number)=>{
    setPosterRatios(previous=>previous[id]===ratio?previous:{...previous,[id]:ratio});
  };
  const model=useMemo(()=>describeRealArchive(records,search),[records,search]);
  const active=model.records;
  const firstPosters=useMemo(()=>curateFeaturedRecords(
    describeRealArchive(records).records, record=>Boolean(primaryMedia(record)),5,
  ),[records]);
  useEffect(()=>{
    let alive=true;
    const scope=currentStorageScope();
    setPosters(firstPosters.map(record=>({id:record.id,title:record.title,city:record.city})));
    void Promise.all(firstPosters.map(async record=>{
      const asset=primaryMedia(record) as MediaAsset;
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
    setNotice("已按记录版本原子移入本机回收站；原图没有删除。云端变更仍须另行安全同步。");
    setReload(n=>n+1);
  };

  const saveLocalDraft=async (draft:EventRecord)=>{
    if(!canEdit || !editing || editing.scope!==currentStorageScope()) {
      throw new Error("账号作用域已更改；未保存任何记录");
    }
    await requireAuthorizedWriter(editing.scope);
    const result=await saveRecordDraft(new IndexedDbRecordRepository(editing.scope),draft,editing.baseline);
    if(result.status==="review-required") {
      throw new Error("另一标签页已修改此记录。当前草稿保持打开；请复制修改内容并重新载入最新档案核对。");
    }
    if(currentStorageScope()!==editing.scope) throw new Error("保存期间账号已切换，请重新核查档案");
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
      if((push||pull)&&(!transferApproval||
          transferApproval.scope!==scoped.scope||
          transferApproval.push!==push||transferApproval.pull!==pull)){
        setTransferApproval({scope:scoped.scope,push,pull});
        setNotice(`首次同步预计本机新增上传 ${push} 条、云端新增下载 ${pull} 条。
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
  // One continuous scroll contains every matching record; images load lazily.
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
    brand={<><span className="v3-preview-brand">◈</span>
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
        <strong>{page==="档案"?"演出档案":page==="迁移"?"备份与迁移":page}</strong>
        <small>{canEditLocal?"本机编辑"
          : canEditAccount?"账号已启用 V3 安全同步"
          : canEditLegacyAccount?"账号本机可编辑 · 云端仍由 V2 管理"
          : "正在验证账号写入权限"}</small></div>
      <div className="v3-real-topbar-stats"><b>{active.length}<small>档案</small></b>
        <b>{model.watchedCount}<small>已看</small></b>
        <b>{model.cities.length}<small>城市</small></b></div>
      {canEdit && <button type="button" onClick={()=>startEdit(null)}>
        {canEditLocal?"新增本机演出":"新增演出"}</button>}
      {canEditAccount && <button className="v3-real-sync-trigger" type="button" onClick={()=>void safeSync()} disabled={syncBusy||snapshot.busy}>
        {syncBusy?"安全检查与同步中…":"安全同步"}</button>}
      <button type="button" onClick={()=>{setShareRecord(null);setSharing(true);}}
        disabled={!records.length}>制作分享图</button>
      {canEdit && <button type="button" onClick={()=>setImportOpen(true)}
        disabled={snapshot.busy||syncBusy||restoreBusy}>
        批量导入
      </button>}
      {canEditLocal && <button type="button" onClick={()=>void exportVerifiedLocalBackup()}
        disabled={exportBusy||restoreBusy||snapshot.busy}>
        {exportBusy?"完整原图备份中…":"导出可恢复本机备份"}
      </button>}
      <button type="button" onClick={()=>setReload(n=>n+1)}
        disabled={snapshot.busy||syncBusy}>刷新</button>
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
      ? <ShareStudio experience="v3" records={shareRecord?[shareRecord]:records} format={shareFormat} setFormat={setShareFormat}
          mapSettings={readSettings().map}
          onOpenMapSettings={()=>{
            setSharing(false);
            setNotice("地图密钥尚未在 V3 中单独配置；请先在 V2 设置页配置，再返回 V3 分享。");
          }}
          onClose={()=>{setSharing(false);setShareRecord(null);}}/>
      : editing && editing.scope===actualScope && canEdit
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
        <V3FeaturedHero posters={posters} frameRatio={frameRatio}
          onNaturalRatio={measurePoster} onBrowse={()=>
          document.getElementById("v3-real-archive-controls")?.scrollIntoView({behavior:"smooth",block:"start"})}/>
        <div id="v3-real-archive-controls" className="v3-real-archive-controls">
          <ActionToolbar
            search={<input aria-label="搜索真实档案" value={search}
              placeholder="搜索演出、艺人、城市、场馆…" onChange={event=>setSearch(event.target.value)}/>}
            modes={archiveModes.map(item=><button type="button" key={item}
              aria-pressed={mode===item} onClick={()=>setMode(item)}>{item}</button>)}
            actions={<select className="v3-real-extra-views" aria-label="更多档案视图"
              value={advancedLayouts[mode]?mode:""}
              onChange={event=>setMode(event.target.value as Mode)}>
              <option value="">更多视图</option>
              {Object.keys(advancedLayouts).map(label=>
                <option key={label} value={label}>{label}</option>)}
            </select>}/>
        </div>
        {!active.length?<div className="v3-real-panel"><h2>没有符合条件的记录</h2>
          <p>请调整搜索词；此页不会生成任何演示档案。</p></div>:
        advancedLayouts[mode]?<div className="v3-real-embedded-archive">
          <ArchivePage records={records.filter(row=>!row.deletedAt)}
            settings={readSettings()}
            layout={advancedLayouts[mode]} setLayout={layout=>{
              const found=Object.entries(advancedLayouts).find(([,value])=>value===layout);
              setMode(found?.[0] as Mode || "海报");
            }}
            shareMode={false} setShareMode={setSharing}
            shareFormat={shareFormat} setShareFormat={setShareFormat}
            onOpen={row=>setSelectedId(row.id)}
            onEdit={row=>startEdit(row)}
            onDuplicate={requestDuplicate}
            onDelete={row=>canEdit?setDeleteCandidate(row):setNotice("账号当前不允许写入，未删除记录")}
            onZoom={setZoomMedia}
            onOpenMapSettings={()=>setNotice("地图密钥沿用原有设置。")}/>
          </div>:
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
      {page==="迁移" && <>
        <button type="button" className="v3-real-classic-fallback" onClick={backToV2}>
          进入经典 V2（兼容编辑与原有同步）
        </button>
        <section className="v3-real-panel">
          <header><span>SAFE DATA MANAGEMENT</span><h2>备份与迁移</h2></header>
          <p>保护原图和现有档案；迁移必须经过真实账号授权与可恢复备份验收。</p>
        </section>
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
        {access.mode==="account" && validScope &&
          <V3MigrationPanel settings={readSettings()} records={records}
            personalConnected={hasPersonalCloudConnection(readSettings())}/>}
      </>}

      {page==="城市" && <RealCityView records={records} onOpen={setSelectedId}/>}
    </>}
  </WorkspaceShell>;
}
