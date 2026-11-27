import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, MapPin, CloudAlert } from "lucide-react";
import { BrandMark } from "../../brand";
import { useAccess } from "../../access";
import type { AppSettings, EventRecord, MediaAsset } from "../../domain";
import { primaryMedia, mediaKindLabels, sourceLabels, statusLabels, categoryLabels } from "../../domain";
import { currentStorageScope, listRecords, normalizeRecord, readSettings, writeSettings } from "../../storage";
import { VenueView } from "../../archive";
import type { V3SyncRuntime } from "../../infrastructure/createV3SyncRuntime";
import { resolveMediaSource, useCachedMediaSrc } from "../../mediaCache";
import { describeRealArchive, isWatchedRealRecord } from "../../core/application/describeRealArchive";
import { saveRecordDraft } from "../../core/application/saveRecordDraft";
import { IndexedDbRecordRepository } from "../../infrastructure/indexedDb/recordRepository";
import { RecordEditor } from "../../overlays";
import { blankRecord } from "../../seeds";
import { ShareStudio, type ShareFormat } from "../../shareStudio";
import { duplicateRecordForNextShow } from "../../recordActions";
import { createConcertReminderHandoff } from "../../core/application/concertReminderHandoff";
import { hasPersonalCloudConnection } from "../../supabase";
import { ConfirmDialog, ImageZoom, ImportDrawer } from "../../overlays";
import { V3MigrationPanel } from "../system/V3MigrationPanel";
import { ActionToolbar, WorkspaceShell } from "../system/WorkspaceShell";
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
const autoSyncPreferenceKey="live-memory-v3-auto-sync";
function readAutoSyncPreference(){
  try{return window.localStorage.getItem(autoSyncPreferenceKey)!=="off";}
  catch{return true;}
}
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
  const src=useCachedMediaSrc(primaryMedia(record));
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
  const src=useCachedMediaSrc(primaryMedia(record));
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
          disabled={!primaryMedia(record)}
          onClick={()=>{const art=primaryMedia(record);if(art)onZoom(art);}}
          aria-label={primaryMedia(record)?"放大主海报":"此记录没有可放大的主海报"}>
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
  const [year,setYear]=useState("");
  const all=useMemo(()=>describeRealArchive(records),[records]);
  const data = useMemo(() => describeRealArchive(year?records.filter(r=>r.date.startsWith(year+"-")):records), [records,year]);
  const watched=data.records.filter(r=>isWatchedRealRecord(r));
  const priced=watched.filter(r=>typeof r.price==="number"&&Number.isFinite(r.price));
  const total=priced.reduce((sum,r)=>sum+(r.price??0),0);
  const artists=new Map<string,number>();
  for(const row of watched)for(const artist of new Set(row.artists))artists.set(artist,(artists.get(artist)||0)+1);
  const ranked=[...artists].sort((a,b)=>b[1]-a[1]).slice(0,10);
  const months=Array.from({length:12},(_,i)=>({label:String(i+1)+"月",total:watched.filter(r=>r.date.slice(5,7)===String(i+1).padStart(2,"0")).length}));
  return (
    <section className="v3-real-panel">
      <header className="v3-stats-heading"><h1>观演统计</h1>
        <label>年份 <select aria-label="统计年份" value={year} onChange={e=>setYear(e.target.value)}>
          <option value="">全部年份</option>{all.years.map(row=><option key={row.year}>{row.year}</option>)}
        </select></label></header>
      <div className="v3-real-metrics">
        <article><strong>{data.records.length}</strong><span>有效档案</span></article>
        <article><strong>{data.watchedCount}</strong><span>已看演出</span></article>
        <article><strong>{data.cities.length}</strong><span>涉及城市</span></article>
        <article><strong>¥{total.toLocaleString("zh-CN",{maximumFractionDigits:2})}</strong><span>已看演出票价</span><small>{priced.length} 场有票价记录</small></article>
      </div>
      <div className="v3-real-breakdown">
        <div><h2>{year||"历年"}月度观演</h2><div className="v3-stats-months">
          {months.map(m=><div key={m.label}><b>{m.total}</b><span><i style={{height:100*m.total/Math.max(1,...months.map(x=>x.total))+"%"}}/></span><small>{m.label}</small></div>)}
        </div></div>
        <div><h2>常看艺人</h2>{ranked.map(([label,count])=><div className="v3-real-bar-row" key={label}>
          <span title={label}>{label}</span><div><i style={{width:100*count/Math.max(1,...ranked.map(r=>r[1]))+"%"}}/></div><b>{count}</b>
        </div>)}{!ranked.length&&<p>暂无已看艺人记录</p>}</div>
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
export function V3RealWorkspace() {
  const access=useAccess();
  const [page,setPage]=useState<Page>("档案");
  const [showLegacyDiagnostics,setShowLegacyDiagnostics]=useState(false);
  const [mode,setMode]=useState<Mode>(savedArchiveMode);
  const [featuredOpen,setFeaturedOpen]=useState(false);
  const [posterSize,setPosterSize]=useState<"compact"|"balanced"|"large">(()=>{
    try{const v=localStorage.getItem("live-memory-poster-size");return v==="compact"||v==="large"?v:"balanced";}catch{return "balanced";}
  });
  useEffect(()=>{try{localStorage.setItem("live-memory-poster-size",posterSize);}catch{}},[posterSize]);
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
  const [exportBusy,setExportBusy]=useState(false);
  const [restorePreview,setRestorePreview]=useState<{
    scope:string;name:string;document:unknown;records:number;assets:number;bytes:number;
  }|null>(null);
  const [editing,setEditing]=useState<{draft:EventRecord;baseline:EventRecord|null;scope:string}|null>(null);
  const [notice,setNotice]=useState("");
  const [syncIssue,setSyncIssue]=useState("");
  const [mapEditor,setMapEditor]=useState<{scope:string;map:AppSettings["map"]}|null>(null);
  const [mapRevision,setMapRevision]=useState(0);
  const [cloudMode,setCloudMode]=useState<{scope:string;mode:"v2"|"v3";error:string}>({
    scope:"",mode:"v2",error:"",
  });
  const accountRuntime=useRef<{scope:string;runtime:V3SyncRuntime}|null>(null);
  const rescueStarted=useRef<Set<string>>(new Set());
  const [syncBusy,setSyncBusy]=useState(false);
  const [autoSyncEnabled,setAutoSyncEnabled]=useState(readAutoSyncPreference);
  const lastAutoSyncAt=useRef(0);
  const [transferApproval,setTransferApproval]=useState<{
    scope:string;push:number;pull:number;
  }|null>(null);
  const [posters,setPosters]=useState<Array<{id:string;title:string;city:string;src?:string}>>([]);
  const [posterRatios,setPosterRatios]=useState<Record<string,number>>({});
  const actualScope=currentStorageScope();
  useEffect(()=>{
    const update=()=>setReload(value=>value+1);
    window.addEventListener("qihub-native-memory-accepted",update);
    return ()=>window.removeEventListener("qihub-native-memory-accepted",update);
  },[]);
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
              const review=await runtime.audit();
              if(!alive||currentStorageScope()!==scope)return;
              setSyncIssue(review.requiresMigrationReview?`${review.unresolved} 条档案需要核对版本。`:
                review.actions["push-new"]||review.actions["pull-new"]?"存在尚未同步的新增档案。":"");
            }
            readyForRescue=true;
          }catch{
            if(alive&&currentStorageScope()===scope){
              try{
                const audit=await runtime.audit();
                if(alive&&currentStorageScope()===scope)
                  setSyncIssue(audit.requiresMigrationReview?`${audit.unresolved} 条档案需要核对版本。`:audit.actions["push-new"]||audit.actions["pull-new"]?"存在尚未同步的档案。":"档案已核对，部分历史原图仍待检查。");
              }catch{
                if(alive&&currentStorageScope()===scope)setSyncIssue("暂时无法核对云端档案，请重试同步。");
              }
            }
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
  useEffect(()=>{setNotice("");setSyncIssue("");setMapEditor(null);setRestorePreview(null);setSharing(false);},[access.mode,access.user?.id]);
  const records=snapshot.scope===actualScope?snapshot.records:[];
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
  const visibleModel=useMemo(()=>describeRealArchive(records),[records]);
  const firstPosters=useMemo(()=>curateFeaturedRecords(
    describeRealArchive(records).records, record=>Boolean(primaryMedia(record)),5,
  ),[records]);
  useEffect(()=>{
    if(!featuredOpen)return;
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
  },[firstPosters,featuredOpen]);
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
  const exportAndroidConcertReminders=async()=>{
    if(!canEdit||snapshot.busy||syncBusy)return;
    const scope=currentStorageScope();
    try{
      const {downloadBlob}=await import("../../media");
      const {stableSerialize}=await import("../../core/sync/revision");
      const originals=await listRecords();
      if(scope!==currentStorageScope())throw Error("REMINDER_EXPORT_ACCOUNT_CHANGED");
      if(!originals.length){setNotice("当前设备没有演出记录可供导出。");return;}
      const baseline=new Map(originals.map(row=>[row.id,stableSerialize(row)]));
      const handoff=createConcertReminderHandoff(originals);
      const latest=await listRecords();
      if(scope!==currentStorageScope()||latest.length!==originals.length||
        latest.some(row=>baseline.get(row.id)!==stableSerialize(row))){
        throw Error("REMINDER_EXPORT_ARCHIVE_CHANGED");
      }
      downloadBlob(JSON.stringify(handoff),
        "live-memory-concert-reminders-"+new Date().toISOString().slice(0,10)+".json",
        "application/json");
      const schedulable=handoff.records.filter(row=>
        !row.deletedAt&&row.status==="planned"&&row.recordState==="normal"&&row.time).length;
      setNotice(`已导出 ${handoff.records.length} 条演出日程（可排程 ${schedulable} 条）。含场馆、座位、取消标记，不含票根、订单或媒体；在 Qi Ledger 安卓端「提醒与通知」导入后才会设置本地提醒。`);
    }catch(error){
      setNotice("演出提醒导出失败，未改变档案。"+
        (error instanceof Error?" "+error.message:""));
    }
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
        setSyncIssue("存在需要确认的历史版本差异。");
        setNotice("请在数据与备份中核对历史版本差异。");
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
      setSyncIssue(result.deferredIds.length?"部分档案待重试。":"");
      setNotice(`同步完成：上传 ${result.uploadedIds.length} 条、
        下载 ${result.downloadedIds.length} 条，待重试 ${result.deferredIds.length} 条。`);
      setReload(n=>n+1);
    }catch(error){
      const reason=error instanceof Error?error.message:"";
      setSyncIssue("同步待处理");
      setNotice(reason.includes("V3_SYNC_MIGRATION_REVIEW_REQUIRED")
        ? "云端或本机存在需要审查的历史差异；没有进行覆盖式同步。"
        : "同步未完成：身份变化、网络故障或云端版本冲突。已保留本机记录，请重新检查。");
    }finally{setSyncBusy(false);}
  };
  useEffect(()=>{
    if(!autoSyncEnabled||!canEditAccount||cloudMode.mode!=="v3"||
      cloudMode.scope!==currentStorageScope())return;
    let active=true;
    let running=false;
    const check=async()=>{
      if(!active||running||!navigator.onLine||document.hidden||
        syncBusy||snapshot.busy||editing||restoreBusy||exportBusy)return;
      if(Date.now()-lastAutoSyncAt.current<60_000)return;
      const scoped=accountRuntime.current;
      if(!scoped||scoped.scope!==currentStorageScope())return;
      running=true;
      lastAutoSyncAt.current=Date.now();
      try{
        if(await scoped.runtime.writerMode()!=="v3"||
          currentStorageScope()!==scoped.scope)return;
        const audit=await scoped.runtime.audit();
        if(!active||currentStorageScope()!==scoped.scope)return;
        // No automatic first-time history transfer or unresolved conflicts.
        // Those retain the manual two-click review in safeSync.
        if(audit.requiresMigrationReview||audit.actions["push-new"])return;
        const result=await scoped.runtime.synchronize({
          v2AutoSyncDisabled:true,initialTransferApproved:false,ongoingAutoSync:true,
        });
        if(active&&currentStorageScope()===scoped.scope&&
          (result.uploadedIds.length||result.downloadedIds.length)){
          setReload(n=>n+1);
          setNotice(`网络恢复后已自动同步：上传 ${result.uploadedIds.length} 条、下载 ${result.downloadedIds.length} 条；尚有 ${result.deferredIds.length} 条待处理。`);
        }
      }catch{
        // Do not discard drafts or claim a cloud ACK on an unreliable WAN.
      }finally{running=false;}
    };
    const online=()=>{void check();};
    window.addEventListener("online",online);
    const visible=()=>{if(!document.hidden)void check();};
    document.addEventListener("visibilitychange",visible);
    window.addEventListener("focus",visible);
    const refreshTimer=window.setInterval(visible,60_000);
    void check();
    return ()=>{
      active=false;
      window.removeEventListener("online",online);
      document.removeEventListener("visibilitychange",visible);
      window.removeEventListener("focus",visible);
      window.clearInterval(refreshTimer);
    };
  },[autoSyncEnabled,canEditAccount,cloudMode.mode,cloudMode.scope,
      syncBusy,snapshot.busy,editing,restoreBusy,exportBusy]);
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
      </>}
    navigation={navButtons}
    mobileNavigation={navButtons}
    navigationLayout="top"
    appearance="liquid"
    demoStatus={false}
    showStatusCenter={false}
    activity={{type:"idle"}}
    toolbar={<div className="v3-real-topbar">
      <div className="v3-real-context">
        <strong>{page==="档案"?"演出档案":page==="数据"?"数据与备份":page}</strong>
        <small>{canEditLocal?"本机档案"
          : canEditAccount?"当前账户 · 云端同步可用"
          : canEditLegacyAccount?"当前账户 · 本机修改待同步"
          : "正在连接你的档案"}</small></div>
      {syncIssue&&<details className="v3-sync-status"><summary><CloudAlert size={16}/> 同步待处理</summary>
        <div><p>{syncIssue}</p><button type="button" onClick={()=>{setPage("数据");setShowLegacyDiagnostics(true);}}>查看同步诊断</button>
          {canEditAccount&&<button type="button" onClick={()=>void safeSync()} disabled={syncBusy}>重试同步</button>}</div>
      </details>}
      <div className="v3-real-topbar-stats"><b>{visibleModel.records.length}<small>档案</small></b>
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
            <button type="button" onClick={()=>{
              setAutoSyncEnabled(value=>{
                const next=!value;
                try{window.localStorage.setItem(autoSyncPreferenceKey,
                  next?"on":"off");}catch{}
                return next;
              });
            }}>{autoSyncEnabled?"关闭联网自动同步":"开启联网自动同步"}</button>
            <button type="button" disabled={!canEdit||snapshot.busy||syncBusy}
              onClick={event=>{
                event.currentTarget.closest("details")?.removeAttribute("open");
                void exportAndroidConcertReminders();
              }}>导出安卓演出／座位提醒 JSON</button>
            <button type="button" onClick={event=>{
              event.currentTarget.closest("details")?.removeAttribute("open");
              setPage("数据");
            }}>数据与备份</button>
            <button type="button" onClick={event=>{event.currentTarget.closest("details")?.removeAttribute("open");backToV2();}}>经典版 V2</button>
          </div>
        </details>
      </div>
    </div>}
    overlay={mapEditor&&mapEditor.scope===actualScope
      ? <div className="v3-real-modal-backdrop"><section className="v3-real-modal v3-map-settings" role="dialog" aria-label="地图设置" aria-modal="true">
        <header><h2>地图设置</h2><button type="button" aria-label="关闭地图设置" onClick={()=>setMapEditor(null)}>×</button></header>
        <label>地图来源<select value={mapEditor.map.provider} onChange={e=>setMapEditor({...mapEditor,map:{...mapEditor.map,provider:e.target.value as AppSettings["map"]["provider"]}})}>
          <option value="offline">离线城市摘要</option><option value="amap">高德地图</option></select></label>
        {mapEditor.map.provider==="amap"&&<><label>高德 Web API Key<input type="password" autoComplete="off" value={mapEditor.map.amapKey} onChange={e=>setMapEditor({...mapEditor,map:{...mapEditor.map,amapKey:e.target.value}})}/></label>
          <label>安全密钥<input type="password" autoComplete="off" value={mapEditor.map.amapSecurityCode} onChange={e=>setMapEditor({...mapEditor,map:{...mapEditor.map,amapSecurityCode:e.target.value}})}/></label></>}
        <footer><button type="button" onClick={()=>setMapEditor(null)}>取消</button><button type="button" onClick={()=>{
          if(currentStorageScope()!==mapEditor.scope)return;
          writeSettings({...readSettings(),map:mapEditor.map});setMapRevision(n=>n+1);setMapEditor(null);
        }}>保存地图设置</button></footer>
      </section></div>
      : importOpen && canEdit
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
            setMapEditor({scope:actualScope,map:readSettings().map});
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
          {mode==="海报"&&firstPosters.length>0&&<button type="button"
            aria-expanded={featuredOpen} className={featuredOpen?"is-active":""}
            onClick={()=>setFeaturedOpen(value=>!value)}>精选现场 {featuredOpen?"收起":"展开"}</button>}
          {filterApplied&&<button type="button" className="v3-real-refine-clear"
            onClick={clearArchiveFilters}>清除筛选</button>}
          {mode==="海报"&&<label className="v3-poster-size">海报大小<select aria-label="海报大小" value={posterSize} onChange={e=>setPosterSize(e.target.value as typeof posterSize)}>
            <option value="balanced">标准</option><option value="compact">紧凑</option><option value="large">大图</option>
          </select></label>}
          <span className="v3-real-results" aria-live="polite">{filterApplied?"筛选结果":"全部演出"} <b>{active.length}</b> / {visibleModel.records.length} 场</span>
        </div>
        </div>
        {mode==="海报"&&featuredOpen&&<V3FeaturedHero posters={posters} frameRatio={frameRatio}
          onNaturalRatio={measurePoster} onBrowse={()=>setFeaturedOpen(false)}/>}
        {!active.length?<div className="v3-real-panel"><h2>没有符合条件的记录</h2>
          <p>当前筛选下没有演出。</p><button type="button" onClick={clearArchiveFilters}>显示全部档案</button></div>:
        collectionModes.includes(mode as CollectionMode)?
          <V3ArchiveCollections mode={mode as CollectionMode} records={active}
            onOpen={setSelectedId}
            onEdit={canEdit?startEdit:undefined}
            onShare={record=>{setShareRecord(record);setSelectedId(null);setSharing(true);}}/>:
                mode==="海报"?<section className="v3-real-panel v3-real-gallery-panel" aria-label="全部演出">
          <div className="v3-real-poster-grid" data-poster-size={posterSize}>
            {active.map(record=><PosterCard key={record.id} record={record}
              onOpen={setSelectedId} onEdit={canEdit?startEdit:undefined}
              frameRatio={frameRatio} onNaturalRatio={measurePoster}/>)}
          </div></section>:
        mode==="时间线"?<section className="v3-real-panel v3-real-chronicle">
          <header><h2>演出时间线</h2></header>
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
        <section className="v3-real-panel v3-real-index-panel" aria-label="演出索引">
          <div className="v3-real-index-list">
            {active.map(record=><RecordIndexCard key={record.id} record={record}
              onOpen={setSelectedId} onEdit={canEdit?startEdit:undefined}
              frameRatio={frameRatio}/>)}
          </div>
        </section>}
      </>}
      {page==="统计" && <RealStatistics records={records}/>}
      {page==="数据" && <>
        <section className="v3-real-panel v3-real-data-heading">
          <header><h2>数据与备份</h2></header>
          <p>原始档案与图片始终保留。备份、恢复等操作仅在手动确认后执行。</p>
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

      {page==="城市" && <section className="v3-city-workspace" aria-label="城市与场馆">
        <header><h1>城市与场馆</h1><span><MapPin size={16}/> {describeRealArchive(records).cities.length} 座城市</span></header>
        <VenueView key={mapRevision} records={describeRealArchive(records).records} mapSettings={readSettings().map}
          onOpenMapSettings={()=>setMapEditor({scope:actualScope,map:readSettings().map})}
          onOpen={record=>setSelectedId(record.id)}/>
      </section>}
    </>}
  </WorkspaceShell>;
}
