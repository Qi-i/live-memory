import {useMemo,useState,type CSSProperties} from "react";
import {CalendarDays,MapPin,Music2,Ticket,ArrowUpRight} from "lucide-react";
import type {EventRecord} from "../../domain";
import {categoryLabels,primaryMedia,statusLabels} from "../../domain";
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
function Artwork({record,frameRatio=2/3}:{
  record:EventRecord;frameRatio?:number;
}){
  const src=useCachedMediaSrc(primaryMedia(record));
  return <AdaptivePoster src={src} alt={record.title+"海报"}
    frameRatio={frameRatio} className="v3-collection-artwork"/>;
}
function Meta({record}:{record:EventRecord}){
  return <span className="v3-collection-meta">
    {record.date||"日期待补"} · {record.city||"城市待补"} · {statusLabels[record.status]}
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
      {records.map((record,index)=><article key={record.id}
        className={index===0?"is-featured":""}>
        <button type="button" className="v3-collection-showcase-image"
          aria-label={"查看 "+record.title} onClick={()=>onOpen(record.id)}>
          <Artwork record={record} frameRatio={index===0?4/5:2/3}/>
        </button>
        <div className="v3-collection-showcase-caption">
          <strong>{record.title}</strong><Meta record={record}/>
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
          <span>{categoryLabels[record.category]} · {statusLabels[record.status]}</span>
          <h3>{record.title}</h3>
          <p>{record.artists.join(" · ")||"艺人待补"}</p>
          <div><CalendarDays size={14}/>{record.date||"日期待补"}</div>
          <div><MapPin size={14}/>{record.venue||record.city||"场馆待补"}</div>
          {record.seat&&<div><Ticket size={14}/>{record.seat}</div>}
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
          <span>LIVE MEMORY / ADMIT ONE</span>
          <h3>{record.title}</h3><p>{record.artists.join(" · ")||"艺人待补"}</p>
          <dl><div><dt>DATE</dt><dd>{record.date||"待补"}</dd></div>
            <div><dt>VENUE</dt><dd>{record.venue||record.city||"待补"}</dd></div>
            <div><dt>SEAT</dt><dd>{record.seat||"未记录"}</dd></div></dl>
          <Actions record={record} onOpen={onOpen} onEdit={onEdit} onShare={onShare} records={records} mode="票根"/>
        </div>
        <span className="v3-collection-stub-number" aria-hidden="true">LM · {record.date.slice(0,4)}</span>
      </article>)}
    </div>
  </section>;
}
function Calendar({records,onOpen}:Pick<Props,"records"|"onOpen">){
  const newest=records.find(record=>/^\d{4}-\d{2}/.test(record.date))?.date.slice(0,7);
  const [selectedMonth,setSelectedMonth]=useState(newest||new Date().toISOString().slice(0,7));
  const [year,month]=selectedMonth.split("-").map(Number);
  const start=new Date(year,month-1,1);
  const offset=(start.getDay()+6)%7;
  const days=new Date(year,month,0).getDate();
  const cells=Math.ceil((offset+days)/7)*7;
  const grouped=useMemo(()=>groupCalendarDays(records,selectedMonth),[records,selectedMonth]);
  function move(delta:number){
    const next=new Date(year,month-1+delta,1);
    setSelectedMonth(`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}`);
  }
  return <section className="v3-collection v3-collection-calendar" aria-label="日历视图">
    <header><span>YOUR LIVE CALENDAR</span><h2>演出日历</h2>
      <p>按月查看实际演出安排，点击场次查看完整档案。</p></header>
    <div className="v3-collection-month-nav">
      <button type="button" onClick={()=>move(-1)} aria-label="上个月">‹</button>
      <strong>{year} 年 {month} 月</strong>
      <button type="button" onClick={()=>move(1)} aria-label="下个月">›</button>
      <button type="button" onClick={()=>setSelectedMonth(new Date().toISOString().slice(0,7))}>本月</button>
    </div>
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
  const format=(n:number)=>"¥"+n.toLocaleString("zh-CN",{maximumFractionDigits:2});
  return <section className="v3-collection" aria-label="票价视图">
    <header><span>YOUR SHOW BUDGET</span><h2>票价记录</h2>
      <p>仅汇总已填写的票价；不把票面价推定为实际支付额。</p></header>
    <div className="v3-collection-cost-totals">
      <article><small>已记录票价合计</small><strong>{format(priceSummary.total)}</strong></article>
      <article><small>有票价的场次</small><strong>{priceSummary.count}</strong></article>
      <article><small>未填写价格</small><strong>{priceSummary.missing}</strong></article>
    </div>
    <div className="v3-collection-cost-list">
      {records.map(record=><button key={record.id} type="button" onClick={()=>onOpen(record.id)}>
        <time>{record.date}</time><strong>{record.title}</strong>
        <span>{typeof record.price==="number"?format(record.price):"票价未记录"}</span>
      </button>)}
    </div>
  </section>;
}
function Summary({records,onOpen}:Pick<Props,"records"|"onOpen">){
  const artists=useMemo(()=>groupByArtist(records),[records]);
  return <section className="v3-collection" aria-label="艺人汇总视图">
    <header><span>ARTISTS YOU HAVE SEEN</span><h2>艺人与现场汇总</h2>
      <p>按实际演出记录聚合，不将同一场的重复阵容算作多场。</p></header>
    <div className="v3-collection-summary-grid">
      {artists.map(([artist,shows])=><article key={artist}>
        <div className="v3-collection-summary-art"><Artwork record={shows[0]}/></div>
        <div className="v3-collection-summary-content">
          <span><Music2 size={14}/> ARTIST / {shows.length} SHOWS</span>
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
  if(mode==="画报")return <Showcase records={records} onOpen={onOpen} onEdit={onEdit} onShare={onShare}/>;
  if(mode==="票夹")return <Wallet records={records} onOpen={onOpen} onEdit={onEdit} onShare={onShare}/>;
  if(mode==="票根")return <Stubs records={records} onOpen={onOpen} onEdit={onEdit} onShare={onShare}/>;
  if(mode==="日历")return <Calendar records={records} onOpen={onOpen}/>;
  if(mode==="城市/场馆")return <Places records={records} onOpen={onOpen}/>;
  if(mode==="票价")return <Costs records={records} onOpen={onOpen}/>;
  if(mode==="汇总")return <Summary records={records} onOpen={onOpen}/>;
  return null;
}
