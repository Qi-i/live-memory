import {useEffect,useMemo,useState,type CSSProperties} from "react";
import {CalendarDays,MapPin,Music2,Ticket,ArrowUpRight} from "lucide-react";
import type {EventRecord} from "../../domain";
import {categoryLabels,primaryMedia,statusLabels,effectiveStatus} from "../../domain";
import {useCachedMediaSrc} from "../../mediaCache";
import {AdaptivePoster} from "./AdaptivePoster";
import {groupByCity,groupByArtist,summarizeRecordedPrices,groupCalendarDays} from "./collectionMetrics";

export type CollectionMode="画报"|"票夹"|"票根"|"日历"|"城市/场馆"|"票价"|"汇总";
export const collectionModes:CollectionMode[]=["画报","票夹","票根","日历","城市/场馆","票价","汇总"];

interface Props {
  mode:CollectionMode;
  records:EventRecord[];
  onOpen:(id:string)=>void;
  onEdit?:(record:EventRecord)=>void;
  onShare:(record:EventRecord)=>void;
}

/** Native V3 experiences own their layout; the old V2 archive is not mounted. */
function Artwork({record,frameRatio=2/3,natural=false}:{
  record:EventRecord;frameRatio?:number;natural?:boolean;
}){
  // Match the V3 archive and share privacy rule: ticket and seat-map photos
  // are never fallback artwork for a public-looking poster card.
  const asset=primaryMedia(record, ["poster"]);
  const src=useCachedMediaSrc(asset);
  const [ratio,setRatio]=useState<number|null>(null);
  const actual=ratio||(asset?.width&&asset.height?asset.width/asset.height:frameRatio);
  return <AdaptivePoster src={src} alt={record.title+"海报"}
    frameRatio={natural?Math.max(.48,Math.min(.92,actual)):frameRatio} onNaturalRatio={natural?setRatio:undefined} className="v3-collection-artwork"/>;
}
function Meta({record}:{record:EventRecord}){
  return <span className="v3-collection-meta">
    {record.date||"日期待补"} · {record.city||"城市待补"} · {statusLabels[effectiveStatus(record)]}
  </span>;
}
function Actions({record,onOpen,onEdit,onShare}:Props&{record:EventRecord}){
  return <div className="v3-collection-actions">
    <button type="button" onClick={()=>onOpen(record.id)}>详情</button>
    {onEdit&&<button type="button" onClick={()=>onEdit(record)}>编辑</button>}
    <button type="button" onClick={()=>onShare(record)}>分享</button>
  </div>;
}
function Showcase({records,onOpen,onEdit,onShare}:Omit<Props,"mode">){
  return <section className="v3-collection v3-collection-showcase" aria-label="画报视图">
    <header><span>THE LIVE EDITION</span><h2>现场画报</h2>
      <p>以海报构成你的现场收藏；每张都可以打开、编辑和分享。</p></header>
    <div className="v3-collection-showcase-grid">
      {records.map(record=><article key={record.id}>
        <button type="button" className="v3-collection-showcase-image"
          aria-label={"查看 "+record.title} onClick={()=>onOpen(record.id)}>
          <Artwork record={record} natural/>
        </button>
        <div className="v3-collection-showcase-caption">
          <strong>{record.title}</strong>
          {record.artists.length>0&&<span className="v3-collection-artists">{record.artists.join(" · ")}</span>}
          <Meta record={record}/>
          {record.venue&&<span className="v3-collection-venue"><MapPin size={13}/>{record.venue}</span>}
          <Actions record={record} onOpen={onOpen} onEdit={onEdit} onShare={onShare} records={records} mode="画报"/>
        </div>
      </article>)}
    </div>
  </section>;
}
function Wallet({records,onOpen,onEdit,onShare}:Omit<Props,"mode">){
  return <section className="v3-collection" aria-label="票夹视图">
    <header><span>YOUR LIVE WALLET</span><h2>我的演出票夹</h2>
      <p>海报、场馆、演出日期与票务信息集中查看。</p></header>
    <div className="v3-collection-wallet-grid">
      {records.map(record=><article className="v3-collection-wallet" key={record.id}
        style={{"--ticket-a":record.colors[0],"--ticket-b":record.colors[1]} as CSSProperties}>
        <div className="v3-collection-wallet-cover"><Artwork record={record}/></div>
        <div className="v3-collection-wallet-info">
          <span>{categoryLabels[record.category]} · {statusLabels[effectiveStatus(record)]}</span>
          <h3>{record.title}</h3>
          <p>{record.artists.join(" · ")||"艺人待补"}</p>
          <div><CalendarDays size={14}/>{record.date||"日期待补"}</div>
          <div><MapPin size={14}/>{record.venue||record.city||"场馆待补"}</div>
          {record.seat&&<div><Ticket size={14}/>{record.seat}</div>}
          {typeof record.price==="number"&&record.price>=0&&
            <div className="v3-collection-wallet-price">票价 ¥{record.price.toLocaleString("zh-CN")}</div>}
          <Actions record={record} onOpen={onOpen} onEdit={onEdit} onShare={onShare} records={records} mode="票夹"/>
        </div>
      </article>)}
    </div>
  </section>;
}
function Stubs({records,onOpen,onEdit,onShare}:Omit<Props,"mode">){
  return <section className="v3-collection" aria-label="票根视图">
    <header><span>THE TICKET COLLECTION</span><h2>纪念票根</h2>
      <p>每张票根沿用原记录的主色、海报、场馆和座位信息。</p></header>
    <div className="v3-collection-stubs">
      {records.map(record=><article key={record.id} className="v3-collection-stub"
        style={{"--ticket-a":record.colors[0],"--ticket-b":record.colors[1]} as CSSProperties}>
        <div className="v3-collection-stub-cover"><Artwork record={record}/></div>
        <div className="v3-collection-stub-main">
          <span>{categoryLabels[record.category]} · {statusLabels[effectiveStatus(record)]}</span>
          <h3>{record.title}</h3><p>{record.artists.join(" · ")||"艺人待补"}</p>
          <dl><div><dt>日期</dt><dd>{[record.date,record.time].filter(Boolean).join(" · ")||"待补"}</dd></div>
            <div><dt>场馆</dt><dd>{[record.city,record.venue].filter(Boolean).join(" · ")||"待补"}</dd></div>
            <div><dt>座位</dt><dd>{record.seat||"未记录"}</dd></div>
            <div><dt>票价</dt><dd>{typeof record.price==="number"?"¥"+record.price.toLocaleString("zh-CN"):"未记录"}</dd></div></dl>
          <Actions record={record} onOpen={onOpen} onEdit={onEdit} onShare={onShare} records={records} mode="票根"/>
        </div>
        <span className="v3-collection-stub-number" aria-hidden="true">LIVE MEMORY · {record.date.slice(0,4)}</span>
      </article>)}
    </div>
  </section>;
}
function Calendar({records,onOpen}:Pick<Props,"records"|"onOpen">){
  const months=[...new Set(records.filter(r=>/^\d{4}-(0[1-9]|1[0-2])/.test(r.date)).map(r=>r.date.slice(0,7)))].sort().reverse();
  const newest=months[0];
  const [selectedMonth,setSelectedMonth]=useState(newest||new Date().toISOString().slice(0,7));
  const [year,month]=selectedMonth.split("-").map(Number);
  const start=new Date(year,month-1,1);
  const offset=(start.getDay()+6)%7;
  const days=new Date(year,month,0).getDate();
  const cells=Math.ceil((offset+days)/7)*7;
  const grouped=useMemo(()=>groupCalendarDays(records,selectedMonth),[records,selectedMonth]);
  const agenda=useMemo(()=>records.filter(record=>record.date.startsWith(selectedMonth))
    .slice().sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title)),
    [records,selectedMonth]);
  function move(delta:number){
    const next=new Date(year,month-1+delta,1);
    setSelectedMonth(`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}`);
  }
  return <section className="v3-collection v3-collection-calendar" aria-label="日历视图">
    <header><span>YOUR LIVE CALENDAR</span><h2>演出日历</h2>
      <p>按月查看实际演出安排，点击场次查看完整档案。</p></header>
    <div className="v3-collection-month-nav">
      <button type="button" onClick={()=>move(-1)} aria-label="上个月">‹</button>
      <label className="v3-calendar-month-picker"><input aria-label="选择演出月份" type="month" value={selectedMonth} onChange={e=>{if(e.target.value)setSelectedMonth(e.target.value)}}/></label>
      <button type="button" onClick={()=>move(1)} aria-label="下个月">›</button>
      <button type="button" onClick={()=>setSelectedMonth(new Date().toISOString().slice(0,7))}>本月</button>
      <span className="v3-calendar-month-count">{agenda.length} 场</span>
    </div>
    <div className="v3-calendar-spread">
    <div className="v3-collection-calendar-grid" role="grid" aria-label={selectedMonth+" 演出日历"}>
      {["一","二","三","四","五","六","日"].map(day=><span className="v3-collection-calendar-weekday" key={day}>{day}</span>)}
      {Array.from({length:cells},(_,index)=>{
        const day=index-offset+1;
        const active=day>=1&&day<=days;
        const events=active?grouped.get(day)||[]:[];
        return <div className={events.length?"has-events":""} key={index} role="gridcell">
          {active&&<><time dateTime={selectedMonth+"-"+String(day).padStart(2,"0")}>{day}</time>
            {events.map(record=><button key={record.id} type="button"
              onClick={()=>onOpen(record.id)} title={record.title}>{record.title}</button>)}</>}
        </div>;
      })}
    </div>
    <div className="v3-collection-calendar-agenda" aria-label="本月演出列表">
      <h3>{month}月演出 <small>{agenda.length} 场</small></h3>
      {agenda.length===0?<p className="v3-collection-agenda-empty">本月还没有演出记录</p>:
        agenda.map(record=><button key={record.id} type="button"
          onClick={()=>onOpen(record.id)} className="v3-collection-agenda-item">
          <span className="v3-collection-agenda-date"><b>{Number(record.date.slice(-2))}</b>
            <small>{record.date.slice(0,7)}</small></span>
          <span className="v3-calendar-poster"><Artwork record={record}/></span>
          <span className="v3-collection-agenda-copy">
            <strong>{record.title}</strong>
            <small>{[record.city,record.venue].filter(Boolean).join(" · ")||"地点待补"}</small>
          </span>
          <ArrowUpRight size={18}/>
        </button>)}
    </div>
    </div>
  </section>;
}
function Places({records,onOpen}:Pick<Props,"records"|"onOpen">){
  const groups=useMemo(()=>groupByCity(records),[records]);
  return <section className="v3-collection" aria-label="城市场馆视图">
    <header><span>WHERE IT HAPPENED</span><h2>城市与场馆</h2>
      <p>{groups.length} 座城市，按场次数量整理你的真实现场。</p></header>
    <div className="v3-collection-places-grid">
      {groups.map(([city,items])=><article key={city}>
        <header><MapPin size={16}/><h3>{city}</h3><strong>{items.length} 场</strong></header>
        <p>{new Set(items.map(r=>r.venue.trim()).filter(Boolean)).size} 个场馆 · 最近 {items[0]?.date||"日期待补"}</p>
        <div>{items.map(record=><button type="button" key={record.id} onClick={()=>onOpen(record.id)}>
          <span>{record.title}</span><time>{record.date}</time><ArrowUpRight size={14}/></button>)}</div>
      </article>)}
    </div>
  </section>;
}
function Costs({records,onOpen}:Pick<Props,"records"|"onOpen">){
  const priceSummary=useMemo(()=>summarizeRecordedPrices(records),[records]);
  const [priceOrder,setPriceOrder]=useState("high");
  const ranked=useMemo(()=>[...records].sort((a,b)=>priceOrder==="date"?b.date.localeCompare(a.date):priceOrder==="low"?(a.price??Infinity)-(b.price??Infinity):(b.price??-1)-(a.price??-1)),[records,priceOrder]);
  const max=Math.max(1,...records.map(r=>r.price??0));
  const format=(n:number)=>"¥"+n.toLocaleString("zh-CN",{maximumFractionDigits:2});
  return <section className="v3-collection" aria-label="票价视图">
    <header><h2>票价记录</h2><p>票面金额 · 不含未记录票价</p></header>
    <div className="v3-collection-cost-totals">
      <article><small>已记录票价合计</small><strong>{format(priceSummary.total)}</strong></article>
      <article><small>有票价的场次</small><strong>{priceSummary.count}</strong></article>
      <article><small>平均票价</small><strong>{priceSummary.count?format(priceSummary.total/priceSummary.count):"—"}</strong></article>
      <article><small>未填写价格</small><strong>{priceSummary.missing}</strong></article>
    </div>
    <label className="v3-collection-local-filter">票价排序 <select aria-label="票价视图排序" value={priceOrder} onChange={e=>setPriceOrder(e.target.value)}><option value="high">从高到低</option><option value="low">从低到高</option><option value="date">按日期</option></select></label>
    <div className="v3-collection-cost-list v3-cost-ranked">
      {ranked.map(record=><button key={record.id} type="button" onClick={()=>onOpen(record.id)}>
        <time>{record.date}</time><strong>{record.title}</strong>
        <i className="v3-price-track" aria-hidden="true"><b style={{width:Math.max(0,100*(record.price??0)/max)+"%"}}/></i>
        <span>{typeof record.price==="number"?format(record.price):"票价未记录"}</span>
      </button>)}
    </div>
  </section>;
}
function Summary({records,onOpen}:Pick<Props,"records"|"onOpen">){
  const [dimension,setDimension]=useState<"艺人"|"城市"|"类型"|"标签">("艺人");
  const artists=useMemo(()=>{
    if(dimension==="艺人")return groupByArtist(records);
    if(dimension==="城市")return groupByCity(records);
    const groups=new Map<string,EventRecord[]>();
    for(const r of records)for(const label of new Set(dimension==="类型"?[categoryLabels[r.category]]:r.tags.filter(Boolean)))groups.set(label,[...(groups.get(label)||[]),r]);
    return [...groups].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0],"zh"));
  },[records,dimension]);
  return <section className="v3-collection" aria-label="艺人汇总视图">
    <header><h2>艺人与现场汇总</h2><p>按{dimension}汇总 · {artists.length} 组</p></header>
    <div className="v3-summary-dimensions" role="group" aria-label="汇总维度">{(["艺人","城市","类型","标签"] as const).map(item=><button key={item} type="button" aria-pressed={dimension===item} onClick={()=>setDimension(item)}>{item}</button>)}</div>
    <div className="v3-collection-summary-grid">
      {artists.map(([artist,shows])=><article key={artist}>
        <div className="v3-collection-summary-art"><Artwork record={shows[0]}/></div>
        <div className="v3-collection-summary-content">
          <span><Music2 size={14}/> {dimension} · {shows.length} 场</span>
          <h3>{artist}</h3>
          <p>{new Set(shows.map(r=>r.city).filter(Boolean)).size} 座城市 · 最近 {shows[0]?.date}</p>
          <div>{shows.map(show=><button type="button" key={show.id} onClick={()=>onOpen(show.id)}>
            <span>{show.title}</span><small>{show.date}</small>
          </button>)}</div>
        </div>
      </article>)}
    </div>
  </section>;
}
export function V3ArchiveCollections({mode,records,onOpen,onEdit,onShare}:Props){
  const [presentation,setPresentation]=useState(false);
  useEffect(()=>{
    if(!presentation)return;
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape")setPresentation(false);
    };
    document.addEventListener("keydown",onKey);
    return()=>document.removeEventListener("keydown",onKey);
  },[presentation]);
  const props={records,onOpen,onEdit,onShare};
  const content=mode==="画报"?<Showcase {...props}/>:
    mode==="票夹"?<Wallet {...props}/>:
    mode==="票根"?<Stubs {...props}/>:
    mode==="日历"?<Calendar records={records} onOpen={onOpen}/>:
    mode==="城市/场馆"?<Places records={records} onOpen={onOpen}/>:
    mode==="票价"?<Costs records={records} onOpen={onOpen}/>:
    <Summary records={records} onOpen={onOpen}/>;
  return <div className={`v3-collection-presentation${presentation?" is-presentation":""}`}>
    <div className="v3-collection-presentation-tools">
      <span>{records.length} 条现场记录 · {mode}</span>
      <button type="button" onClick={()=>setPresentation(current=>!current)}
        aria-pressed={presentation} aria-label={presentation?"退出纯净展示":"纯净截图展示"}
        title={presentation?"返回正常视图":"隐藏操作按钮，便于手机和电脑截图"}>
        {presentation?"退出纯净展示":"纯净截图"}
      </button>
    </div>
    {content}
  </div>;
}
