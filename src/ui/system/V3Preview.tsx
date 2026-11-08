import { useMemo, useState } from "react";
import {
  ActionToolbar, MapSplitPane, StageHero, WorkspaceShell,
  type StagePoster, type StatusHistoryItem,
} from "./WorkspaceShell";
import type { SyncActivity } from "../../core/sync/policy";
import { demoShows, type DemoShow } from "./demoData";
import {
  DemoDetail, DemoEditor, DemoGallery, DemoList, DemoPreferences,
  DemoShare, DemoStatistics, DemoTimeline, type DemoPage, type DemoView,
} from "./DemoFeatures";
import { renderDemoRecap, saveDemoPng } from "./demoShare";
import "./preview.css";

const navigation: DemoPage[] = ["档案", "统计", "地图", "设置", "管理"];
const modes: DemoView[] = ["海报", "时间线", "城市/场馆", "汇总", "列表"];

/** Demonstration fixture only. It is never imported from an account. */
const importedFixture: DemoShow = {
  id: "demo-imported",
  title: "夜色音乐会 · 导入演示",
  artist: "演示乐队",
  city: "北京",
  venue: "城市音乐厅（演示）",
  date: "2026-08-16",
  status: "已看",
};

function PreviewMap({
  onCity, counts,
}: {
  onCity: (city: string) => void;
  counts: Map<string, number>;
}) {
  const markers = [
    { city: "乌鲁木齐", position: "is-west" },
    { city: "北京", position: "is-north" },
    { city: "郑州", position: "is-middle" },
    { city: "福州", position: "is-east" },
  ];
  return (
    <div className="v3-preview-map" aria-label="地图几何预览，非实时地图">
      <span className="v3-preview-map-overline">MEMORY MAP · LAYOUT PREVIEW</span>
      <strong>演出城市</strong>
      <p>地图背景仅用于验证布局。点击演示标记或右侧城市，查看当前演示档案。</p>
      {markers.map(({city,position}) => <div key={city} className={"v3-preview-map-marker "+position}>
        <button type="button" onClick={() => onCity(city)} aria-label={"查看"+city+"的演出"}>{counts.get(city)??0}</button>
        <small>{city}</small>
      </div>)}
    </div>
  );
}

function CityVenueView({ shows, selectedCity, onCity, onCloseCity, onOpen }: {
  shows: DemoShow[];
  selectedCity: string|null;
  onCity:(city:string)=>void;
  onCloseCity:()=>void;
  onOpen:(show:DemoShow)=>void;
}) {
  const counts = useMemo(() => {
    const map=new Map<string,number>();
    for(const show of shows)if(show.city)map.set(show.city,(map.get(show.city)??0)+1);
    return map;
  },[shows]);
  const cities=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"zh-CN"));
  const maxCount=Math.max(1,...cities.map(([_,n])=>n));
  const cityRecords=shows.filter(show=>show.city===selectedCity);
  return <MapSplitPane
    map={<PreviewMap counts={counts} onCity={onCity} />}
    detail={selectedCity && <div className="v3-preview-city-detail" role="dialog" aria-label={selectedCity+"的演出"}>
      <header>
        <div><span>城市</span><strong>{selectedCity}</strong><small>{cityRecords.length} 场演示演出 · 点击海报查看档案</small></div>
        <button type="button" aria-label="关闭城市详情" onClick={onCloseCity}>×</button>
      </header>
      <div className="v3-preview-city-gallery">
        {cityRecords.length ? cityRecords.map(show => <button type="button" key={show.id}
          className="v3-preview-city-archive" onClick={()=>onOpen(show)} aria-label={"查看："+show.title}>
          <div className="v3-preview-city-image">{show.src?<img src={show.src} alt={show.title} loading="lazy"/>:"LIVE"}</div>
          <strong>{show.title}</strong><small>{show.date} · {show.venue}</small>
        </button>) : <p>该城市暂时没有对应演示档案；可以新增一场。</p>}
      </div>
    </div>}
    list={<div className="v3-preview-city-list">
      <header><span>FOOTPRINTS · DEMO</span><h2>常去城市</h2>
        <p>根据当前演示记录计算；地图和排名共用高度约束。</p></header>
      {cities.length ? cities.map(([city,count],i) => <button key={city} type="button"
        aria-pressed={selectedCity===city} onClick={()=>onCity(city)}>
        <strong>{city}</strong>
        <span className="v3-preview-city-bar"><i style={{width:(count/maxCount)*100+"%"}} /></span>
        <b>{count}</b><span className="v3-preview-city-number">{String(i+1).padStart(2,"0")}</span>
      </button>) : <p>当前搜索没有匹配的城市。</p>}
    </div>}
  />;
}

export function V3Preview() {
  const [shows,setShows]=useState<DemoShow[]>(demoShows);
  const [selectedPage,setSelectedPage]=useState<DemoPage>("档案");
  const [selectedMode,setSelectedMode]=useState<DemoView>("城市/场馆");
  const [search,setSearch]=useState("");
  const [selectedCity,setSelectedCity]=useState<string|null>(null);
  const [detail,setDetail]=useState<DemoShow|null>(null);
  const [editor,setEditor]=useState<DemoShow|null|undefined>(undefined);
  const [shareSource,setShareSource]=useState<string|null>(null);
  const [shareBusy,setShareBusy]=useState(false);
  const [appearance,setAppearance]=useState<"liquid"|"editorial">("liquid");
  const [activity,setActivity]=useState<SyncActivity>({type:"connected"});
  const [activityHistory,setActivityHistory]=useState<StatusHistoryItem[]>([
    {id:"initial",time:"演示开始",activity:{type:"connected"}},
  ]);
  const [feedback,setFeedback]=useState("");

  const filtered=useMemo(()=>shows.filter(show=>!search.trim() ||
    [show.title,show.artist,show.city,show.venue,show.date].join(" ").toLowerCase().includes(search.trim().toLowerCase())
  ),[shows,search]);
  const posters:StagePoster[]=filtered.map(({id,title,city,src})=>({id,title,city,src}));
  const attended=shows.filter(show=>show.status==="已看");
  const cityCount=new Set(attended.map(show=>show.city).filter(Boolean)).size;

  const navigate=(page:DemoPage)=>{
    setSelectedPage(page);
    setSelectedCity(null);
    if(page==="地图")setSelectedMode("城市/场馆");
    if(page==="档案"&&selectedPage!=="档案")setSelectedMode("海报");
  };
  const selectMode=(mode:DemoView)=>{
    setSelectedPage("档案");
    setSelectedMode(mode);
    setSelectedCity(null);
  };
  const updateActivity=(next:SyncActivity)=>{
    setActivity(next);
    setActivityHistory(current=>[
      {id:crypto.randomUUID(),time:"刚刚 · 模拟状态",activity:next},...current,
    ].slice(0,8));
  };
  const save=(show:DemoShow)=>{
    setShows(current=>current.some(row=>row.id===show.id)
      ?current.map(row=>row.id===show.id?show:row):[show,...current]);
    setEditor(undefined);
    setDetail(null);
    setFeedback("已保存演示记录。本页刷新后会恢复初始样例，不会写入个人档案。");
  };
  const reset=()=>{
    setShows(demoShows);
    setSearch("");
    setSelectedCity(null);
    setFeedback("演示记录已复位。");
  };
  const importSample=()=>{
    setShows(current=>current.some(show=>show.id===importedFixture.id)?current:[importedFixture,...current]);
    setFeedback("已添加一条预置演示档案（不是从个人文件导入）。");
    setSelectedPage("档案");
    setSelectedMode("海报");
    setSearch("");
  };
  const openShare=async()=>{
    if(shareBusy)return;
    setShareBusy(true);
    try {
      setShareSource(await renderDemoRecap(filtered));
    } catch(error) {
      setFeedback(error instanceof Error?error.message:"分享图片绘制失败");
    } finally {
      setShareBusy(false);
    }
  };
  const navButtons=(items:DemoPage[])=>items.map(page=>
    <button key={page} type="button" aria-current={selectedPage===page?"page":undefined}
      onClick={()=>navigate(page)}>{page}</button>);

  const showingArchive=selectedPage==="档案"||selectedPage==="地图";
  const displayingMode=selectedPage==="地图"?"城市/场馆":selectedMode;
  return <WorkspaceShell
    appearance={appearance}
    brand={<><span className="v3-preview-brand">◈</span> Live Memory <small>V3 · 交互预览</small></>}
    navigation={navButtons(navigation)}
    mobileNavigation={navButtons(navigation.slice(0,4))}
    toolbar={<div className="v3-preview-topbar">
      <div><span>ARCHIVE / V3 · PUBLIC DEMO</span>
        <strong>{selectedPage==="档案"?"演出档案":selectedPage==="地图"?"城市足迹":selectedPage==="统计"?"观演统计":selectedPage==="设置"?"个人外观": "演示数据管理"}</strong>
        <small className="v3-preview-disclosure">仅使用演示记录 · 不读取账号或个人云数据 · 刷新恢复</small>
      </div>
      <div className="v3-preview-topbar-stats">
        <b>{shows.length} <small>记录</small></b><b>{attended.length} <small>已看</small></b><b>{cityCount} <small>城市</small></b>
      </div>
      <button type="button" onClick={()=>updateActivity({type:"transferred",direction:"pull",changedRecords:2})}>模拟云端更新</button>
      <button type="button" onClick={()=>updateActivity({type:"conflict",count:1})}>模拟冲突</button>
    </div>}
    activity={activity}
    activityHistory={activityHistory}
    account={<span>演示沙盒 · 不连接个人账号</span>}
    overlay={<>
      {detail&&editor===undefined&&<DemoDetail show={detail} onClose={()=>setDetail(null)}
        onEdit={()=>{setEditor(detail);setDetail(null)}} />}
      {editor!==undefined&&<DemoEditor key={editor?.id??"new"} initial={editor??null} onClose={()=>setEditor(undefined)} onSave={save} />}
      {shareSource&&<DemoShare source={shareSource} onClose={()=>setShareSource(null)} onDownload={()=>saveDemoPng(shareSource)} />}
      {feedback&&<div className="v3-demo-feedback" role="status"><span>{feedback}</span>
        <button type="button" aria-label="关闭操作提示" onClick={()=>setFeedback("")}>×</button></div>}
    </>}
  >
    {showingArchive&&<>
      <StageHero eyebrow="LIVE MEMORY · EXPERIENCE LIBRARY" title="把现场，留在时间里"
        description="竖版海报完整展示。以下操作均基于演示记录，可体验编辑、城市浏览和分享图片导出。"
        posters={posters} />
      <ActionToolbar
        search={<input aria-label="搜索演出" value={search} onChange={event=>setSearch(event.target.value)}
          placeholder="搜索艺人、场次、城市…" />}
        modes={modes.map(mode=><button key={mode} type="button"
          aria-pressed={displayingMode===mode} onClick={()=>selectMode(mode)}>{mode}</button>)}
        actions={<>
          <button type="button" onClick={importSample}>导入演示记录</button>
          <button type="button" className="v3-demo-primary-action" onClick={()=>setEditor(null)}>新增记录</button>
          <button type="button" disabled={shareBusy} onClick={()=>void openShare()}>{shareBusy?"正在生成…":"生成分享图"}</button>
        </>}
      />
      {displayingMode==="城市/场馆"&&<CityVenueView shows={filtered} selectedCity={selectedCity}
        onCity={setSelectedCity} onCloseCity={()=>setSelectedCity(null)} onOpen={setDetail} />}
      {displayingMode==="海报"&&<DemoGallery shows={filtered} onOpen={setDetail} />}
      {displayingMode==="时间线"&&<DemoTimeline shows={filtered} onOpen={setDetail} />}
      {displayingMode==="汇总"&&<DemoStatistics shows={filtered} />}
      {displayingMode==="列表"&&<DemoList shows={filtered} onOpen={setDetail} />}
    </>}
    {selectedPage==="统计"&&<>
      <DemoStatistics shows={shows} />
      <div className="v3-demo-extra-actions"><button type="button" disabled={shareBusy}
        onClick={()=>void openShare()}>{shareBusy?"正在生成…":"生成演示回顾分享图"}</button></div>
    </>}
    {selectedPage==="设置"&&<DemoPreferences style={appearance} onStyleChange={setAppearance}
      count={shows.length} onReset={reset} />}
    {selectedPage==="管理"&&<>
      <DemoPreferences style={appearance} onStyleChange={setAppearance} count={shows.length} onReset={reset} />
      <div className="v3-demo-extra-actions"><button type="button" onClick={importSample}>导入一条预置演示记录</button>
        <button type="button" onClick={()=>setEditor(null)}>新增演示记录</button>
      </div>
    </>}
  </WorkspaceShell>;
}
