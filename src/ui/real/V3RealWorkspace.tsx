import { useEffect, useMemo, useRef, useState } from "react";
import { useAccess } from "../../access";
import type { EventRecord, MediaAsset } from "../../domain";
import { primaryMedia } from "../../domain";
import { currentStorageScope, listRecords } from "../../storage";
import { resolveMediaSource, useCachedMediaSrc } from "../../mediaCache";
import { describeRealArchive, isWatchedRealRecord } from "../../core/application/describeRealArchive";
import { saveRecordDraft } from "../../core/application/saveRecordDraft";
import { IndexedDbRecordRepository } from "../../infrastructure/indexedDb/recordRepository";
import { RecordEditor } from "../../overlays";
import { blankRecord } from "../../seeds";
import { ActionToolbar, MapSplitPane, StageHero, WorkspaceShell } from "../system/WorkspaceShell";
import "../system/preview.css";
import "./realWorkspace.css";

type Page = "档案" | "统计" | "城市";
type Mode = "海报" | "时间线" | "列表";
const PAGE_SIZE = 18;
const navigation: Page[] = ["档案", "统计", "城市"];
const archiveModes: Mode[] = ["海报", "时间线", "列表"];

function backToV2() {
  const url = new URL(window.location.href);
  url.searchParams.delete("v3-real-workspace");
  window.location.assign(url.href);
}
function PosterCard({ record, onOpen }: { record: EventRecord; onOpen: (id: string) => void }) {
  const asset = primaryMedia(record);
  const src = useCachedMediaSrc(asset);
  return (
    <button className="v3-real-poster-card" type="button" onClick={() => onOpen(record.id)}
      aria-label={"查看 " + record.title}>
      <span className="v3-real-poster-image">
        {src ? <img src={src} loading="lazy" alt={record.title + "海报"}
          onLoad={event => {
            const img=event.currentTarget;
            const ratio=img.naturalHeight>0?img.naturalWidth/img.naturalHeight:0;
            if(ratio>=.45&&ratio<=.95) {
              img.closest<HTMLElement>(".v3-real-poster-image")?.style.setProperty("--v3-real-poster-ratio",String(ratio));
            }
          }}/> : <span>无海报</span>}
      </span>
      <strong title={record.title}>{record.title}</strong>
      <small>{record.date} · {record.city || "城市待补"}</small>
    </button>
  );
}
function RecordDetail({ record, onClose, onEdit }: {
  record: EventRecord; onClose: () => void; onEdit?: (record: EventRecord) => void;
}) {
  const asset = primaryMedia(record);
  const src = useCachedMediaSrc(asset);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="v3-real-modal-backdrop" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="v3-real-modal" role="dialog" aria-modal="true"
        aria-label={record.title + "（只读详情）"}>
        <header><div><small>REAL ARCHIVE · READ ONLY</small><h2>{record.title}</h2>
          <span>{record.date} · {record.city} · {record.venue}</span></div>
          {onEdit && <button type="button" aria-label="编辑本机演出" onClick={()=>onEdit(record)}>编辑</button>}
          <button type="button" aria-label="关闭只读详情" ref={closeRef} onClick={onClose}>×</button>
        </header>
        <div className="v3-real-modal-body">
          <div className="v3-real-modal-art">
            {src ? <img src={src} alt={record.title + "海报"} /> : <span>此记录暂无可用海报</span>}
          </div>
          <dl>
            <dt>艺人</dt><dd>{record.artists.join("、") || "未填写"}</dd>
            <dt>场馆</dt><dd>{record.venue || "未填写"}</dd>
            <dt>观演状态</dt><dd>{record.status === "watched" ? "已看" : record.status === "planned" ? "待看" : "想看"}</dd>
            <dt>归档媒体</dt><dd>{record.media.length} 项</dd>
            <dt>标签</dt><dd>{record.tags.join("、") || "无"}</dd>
            {record.note && <><dt>备注</dt><dd className="v3-real-detail-note">{record.note}</dd></>}
          </dl>
        </div>
        <footer><span>此窗口不会写入、同步或删除任何数据。</span>
          <button type="button" onClick={onClose}>返回档案</button>
        </footer>
      </section>
    </div>
  );
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
  const [pageIndex,setPageIndex]=useState(0);
  const [snapshot,setSnapshot]=useState<{scope:string;records:EventRecord[];error:string;busy:boolean}>({
    scope:"",records:[],error:"",busy:true,
  });
  const [reload,setReload]=useState(0);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [editing,setEditing]=useState<{draft:EventRecord;baseline:EventRecord|null;scope:string}|null>(null);
  const [notice,setNotice]=useState("");
  const [posters,setPosters]=useState<Array<{id:string;title:string;city:string;src?:string}>>([]);
  const actualScope=currentStorageScope();
  const permitted=access.mode==="account" || access.mode==="device";
  const validScope=permitted && Boolean(actualScope) &&
    (access.mode==="device" || actualScope===access.user?.id?.toLowerCase());
  useEffect(()=>{
    let alive=true;
    const scope=currentStorageScope();
    setSelectedId(null);
    setEditing(null);
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
  useEffect(()=>{setNotice("");},[access.mode,access.user?.id]);
  const records=snapshot.scope===actualScope?snapshot.records:[];
  const model=useMemo(()=>describeRealArchive(records,search),[records,search]);
  const active=model.records;
  const firstPosters=useMemo(()=>active.filter(r=>primaryMedia(r)).slice(0,7),[active]);
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
  const startEdit=(record:EventRecord|null)=>{
    if(!canEditLocal) return;
    setEditing({draft:record??blankRecord(),baseline:record??null,scope:actualScope});
    setSelectedId(null);
  };
  const saveLocalDraft=async (draft:EventRecord)=>{
    if(!canEditLocal || !editing || editing.scope!==currentStorageScope()) {
      throw new Error("账号作用域已更改；未保存任何记录");
    }
    const result=await saveRecordDraft(new IndexedDbRecordRepository(editing.scope),draft,editing.baseline);
    if(result.status==="review-required") {
      throw new Error("另一标签页已修改此记录。当前草稿保持打开；请复制修改内容并重新载入最新档案核对。");
    }
    if(currentStorageScope()!==editing.scope) throw new Error("保存期间账号已切换，请重新核查档案");
    setEditing(null);
    setNotice("已安全保存至此设备；尚未启用云同步");
    setReload(n=>n+1);
  };
  const paged=active.slice(PAGE_SIZE*pageIndex,PAGE_SIZE*(pageIndex+1));
  const totalPages=Math.max(1,Math.ceil(active.length/PAGE_SIZE));
  useEffect(()=>{setPageIndex(0);},[search,mode,page]);
  const navButtons=navigation.map(label=><button type="button" key={label}
    aria-current={page===label?"page":undefined} onClick={()=>setPage(label)}>{label}</button>);
  return <WorkspaceShell
    brand={<><span className="v3-preview-brand">◈</span>
      <strong className="v3-preview-brand-name">Live Memory</strong>
      <small>V3 · 真实档案验证</small></>}
    navigation={navButtons}
    mobileNavigation={navButtons}
    appearance="liquid"
    demoStatus={false}
    activity={{type:"idle"}}
    account={<div className="v3-real-account">
      <strong>{access.mode==="account"?"当前账号":"本机独立档案"}</strong>
      <span>{canEditLocal?"本机可编辑 · 无云端写入":"账号只读 · 未接管同步"}</span>
      <button type="button" onClick={backToV2}>返回正式 V2</button></div>}
    toolbar={<div className="v3-real-topbar">
      <div><span>LIVE MEMORY · V3 REAL DATA</span>
        <strong>{page==="档案"?"演出档案":page}</strong>
        <small>{canEditLocal?"本机原子保存 · 云同步未接管":"真实账号只读验证 · 云同步未接管"}</small></div>
      <div className="v3-real-topbar-stats"><b>{active.length}<small>档案</small></b>
        <b>{model.watchedCount}<small>已看</small></b>
        <b>{model.cities.length}<small>城市</small></b></div>
      {canEditLocal && <button type="button" onClick={()=>startEdit(null)}>新增本机演出</button>}
      <button type="button" onClick={()=>setReload(n=>n+1)} disabled={snapshot.busy}>刷新本机快照</button>
      <button type="button" onClick={backToV2}>返回 V2</button>
    </div>}
    overlay={editing && editing.scope===actualScope && canEditLocal
      ? <RecordEditor record={editing.draft} cloudMediaSyncEnabled={false}
          onCancel={()=>setEditing(null)} onSave={saveLocalDraft}/>
      : selected
        ? <RecordDetail record={selected} onClose={()=>setSelectedId(null)}
            onEdit={canEditLocal?startEdit:undefined}/>
        : undefined}
  >
    {notice && <div className="v3-real-save-notice" role="status">{notice}
      <button type="button" onClick={()=>setNotice("")} aria-label="关闭提示">×</button></div>}
    {!validScope || snapshot.error ? <section className="v3-real-panel" role="alert">
      <h2>无法读取当前档案</h2><p>{snapshot.error||"当前未登录私有账号。"}</p>
      <button type="button" onClick={backToV2}>返回正式 V2</button>
    </section> : snapshot.busy ? <section className="v3-real-panel" role="status">正在读取当前设备的档案快照…</section> :
    <>
      {page==="档案" && <>
        <StageHero eyebrow="YOUR ARCHIVE · REAL RECORDS" title="把现场，留在时间里"
          description="读取当前设备实际保存的演出记录。新工作区仍为只读验证，不会触发 V2/V3 并行写入。"
          posters={posters}/>
        <ActionToolbar
          search={<input aria-label="搜索真实档案" value={search} placeholder="搜索演出、艺人、城市、场馆…"
            onChange={event=>setSearch(event.target.value)}/>}
          modes={archiveModes.map(item=><button type="button" key={item}
            aria-pressed={mode===item} onClick={()=>setMode(item)}>{item}</button>)}
          actions={null}/>
        {!paged.length ? <div className="v3-real-panel"><h2>没有符合条件的记录</h2>
          <p>可更换搜索词。此预览不会生成演示档案。</p></div> :
          mode==="海报" ? <section className="v3-real-panel"><header><span>REAL PORTRAIT ARCHIVE</span>
            <h2>海报档案</h2></header><div className="v3-real-poster-grid">
              {paged.map(record=><PosterCard key={record.id} record={record} onOpen={setSelectedId}/>)}
            </div></section> :
          mode==="时间线" ? <section className="v3-real-panel"><header><span>CHRONICLE</span>
            <h2>时间线</h2></header><div className="v3-real-timeline">
              {paged.map(row=><button type="button" key={row.id} onClick={()=>setSelectedId(row.id)}>
                <time>{row.date}</time><strong>{row.title}</strong>
                <small>{row.city} · {row.venue}</small></button>)}
            </div></section> :
          <section className="v3-real-panel"><header><span>RECORD INDEX</span><h2>演出列表</h2></header>
            <div className="v3-real-table-scroll"><table><thead><tr>
              <th>演出</th><th>日期</th><th>城市</th><th>观演状态</th><th>操作</th></tr></thead>
              <tbody>{paged.map(row=><tr key={row.id}>
                <td>{row.title}</td><td>{row.date}</td><td>{row.city}</td>
                <td>{isWatchedRealRecord(row)?"已看":"其他"}</td>
                <td><button type="button" onClick={()=>setSelectedId(row.id)}>查看</button></td>
              </tr>)}</tbody></table></div></section>}
        {active.length>PAGE_SIZE&&<div className="v3-real-pagination">
          <button type="button" disabled={pageIndex===0} onClick={()=>setPageIndex(n=>Math.max(0,n-1))}>上一页</button>
          <span>第 {pageIndex+1} / {totalPages} 页 · 共 {active.length} 条</span>
          <button type="button" disabled={pageIndex>=totalPages-1}
            onClick={()=>setPageIndex(n=>n+1)}>下一页</button>
        </div>}
      </>}
      {page==="统计" && <RealStatistics records={records}/>}
      {page==="城市" && <RealCityView records={records} onOpen={setSelectedId}/>}
    </>}
  </WorkspaceShell>;
}
