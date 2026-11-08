import { useState, type FormEvent } from "react";
import { useDialogBehavior } from "../useDialogBehavior";
import { PortraitArtwork } from "./WorkspaceShell";
import type { DemoShow } from "./demoData";
import "./demoViews.css";

export function DemoArchiveView({ mode, shows, onOpen }: {
  mode: string; shows: DemoShow[]; onOpen: (show: DemoShow) => void;
}) {
  if (!shows.length) return <section className="v3-demo-panel v3-demo-empty" role="status"><h2>没有符合条件的演出</h2><p>试试更换搜索词，或新建一条临时演示记录。</p></section>;
  if (mode === "时间线") return <section className="v3-demo-panel"><header><span>LIVE CHRONICLE</span><h2>时间线</h2><p>按日期阅读自己的现场记录。</p></header><div className="v3-demo-timeline">
    {[...shows].sort((a,b) => b.date.localeCompare(a.date)).map(show => <button type="button" key={show.id} onClick={() => onOpen(show)}>
      <time>{show.date}</time><div className="v3-demo-timeline-art">{show.src && <img src={show.src} alt="" />}</div>
      <span><strong>{show.title}</strong><small>{show.city} · {show.venue}</small></span><em>查看档案</em>
    </button>)}
  </div></section>;
  if (mode === "列表") return <section className="v3-demo-panel"><header><span>RECORD INDEX</span><h2>演出列表</h2><p>信息优先，操作按钮始终可达。</p></header><div className="v3-demo-table-scroll">
    <table><thead><tr><th>演出</th><th>日期</th><th>城市</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>{shows.map(show => <tr key={show.id}><td>{show.title}</td><td>{show.date}</td><td>{show.city}</td>
        <td>{show.status}</td><td><button type="button" onClick={() => onOpen(show)}>查看</button></td></tr>)}</tbody>
    </table>
  </div></section>;
  if (mode === "汇总") return <DemoStatistics shows={shows} />;
  return <section className="v3-demo-panel"><header><span>PORTRAIT ARCHIVE</span><h2>海报档案</h2><p>海报保持纵向完整展示，单击进入详情。</p></header>
    <div className="v3-demo-poster-grid">{shows.map(show => <button key={show.id} type="button" onClick={() => onOpen(show)} aria-label={"查看" + show.title}>
      <PortraitArtwork src={show.src} alt={show.title + "海报"} caption={<><strong>{show.title}</strong><small>{show.date} · {show.city}</small></>}/>
    </button>)}</div>
  </section>;
}

export function DemoStatistics({ shows, onShare }: { shows: DemoShow[]; onShare?: () => void }) {
  const [year, setYear] = useState("全部");
  const years = [...new Set(shows.map(s => s.date.slice(0,4)))].sort().reverse();
  const selected = year === "全部" ? shows : shows.filter(s => s.date.startsWith(year));
  const counts = new Map<string,number>();
  for(const show of selected) counts.set(show.city, (counts.get(show.city) || 0) + 1);
  const cities = [...counts.entries()].sort((a,b) => b[1] - a[1]);
  return <section className="v3-demo-panel"><header><span>MEMORY PROFILE</span><h2>现场履历</h2><p>年份、演出和城市统计均来自当前演示记录。</p></header>
    <div className="v3-demo-years" role="group" aria-label="统计年份">{["全部",...years].map(label => <button type="button" key={label} aria-pressed={label === year} onClick={() => setYear(label)}>{label}</button>)}</div>
    <div className="v3-demo-metrics"><article><strong>{selected.length}</strong><small>收录记录</small></article><article><strong>{selected.filter(s => s.status === "已看").length}</strong><small>已看现场</small></article><article><strong>{cities.length}</strong><small>城市足迹</small></article></div>
    <div className="v3-demo-city-bars">{cities.map(([city, count]) => <div key={city}><strong>{city}</strong><span><i style={{width:String(Math.round(100 * count / selected.length))+"%"}} /></span><b>{count}</b></div>)}</div>
    {onShare && <button className="v3-demo-primary" type="button" onClick={onShare}>预览回顾卡</button>}
  </section>;
}

export function DemoEditor({ existing, onClose, onSave }: {
  existing?: DemoShow; onClose: () => void; onSave: (show: DemoShow) => void;
}) {
  const ref = useDialogBehavior({ onClose, focusSelector: "input[required]" });
  const [title,setTitle]=useState(existing?.title || "");
  const [artist,setArtist]=useState(existing?.artist || "");
  const [date,setDate]=useState(existing?.date || "2026-11-08");
  const [city,setCity]=useState(existing?.city || "");
  const [venue,setVenue]=useState(existing?.venue || "");
  const [status,setStatus]=useState<DemoShow["status"]>(existing?.status || "待看");
  const save=(event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !city.trim() || !date) return;
    onSave({ id: existing?.id || "session-" + Math.random().toString(36).slice(2,9),
      title:title.trim(), artist:artist.trim() || "未注明艺人", city:city.trim(), date,
      venue:venue.trim(), status, src:existing?.src });
    onClose();
  };
  return <div ref={ref} className="v3-demo-backdrop" role="presentation" onMouseDown={e => { if(e.target === e.currentTarget) onClose(); }}>
    <form className="v3-demo-modal" role="dialog" aria-modal="true" aria-label={existing ? "编辑演示记录" : "新增演示记录"} onSubmit={save}>
      <header><div><span>RECORD EDITOR · DEMO</span><h2>{existing ? "编辑演出" : "记录一场现场"}</h2><p>仅保存到当前演示页面的内存中，刷新即恢复，不上传个人数据。</p></div><button type="button" aria-label="关闭编辑窗口" onClick={onClose}>×</button></header>
      <div className="v3-demo-fields"><label>演出名称<input required value={title} onChange={e=>setTitle(e.target.value)}/></label>
        <label>艺人<input value={artist} onChange={e=>setArtist(e.target.value)}/></label>
        <label>日期<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
        <label>城市<input required value={city} onChange={e=>setCity(e.target.value)}/></label>
        <label>场馆<input value={venue} onChange={e=>setVenue(e.target.value)}/></label>
        <label>观演状态<select value={status} onChange={e=>setStatus(e.target.value as DemoShow["status"])}><option>已看</option><option>待看</option></select></label>
      </div>
      <footer><button type="button" onClick={onClose}>取消</button><button type="submit" className="v3-demo-primary">保存演示记录</button></footer>
    </form>
  </div>;
}

export function DemoDetail({ show, onClose, onEdit }: {
  show: DemoShow; onClose: () => void; onEdit: () => void;
}) {
  const ref=useDialogBehavior({onClose, focusSelector:'button[aria-label="关闭演出详情"]'});
  return <div ref={ref} className="v3-demo-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="v3-demo-modal" role="dialog" aria-modal="true" aria-label={show.title + "详情"}>
      <header><div><span>SINGLE LIVE MEMORY</span><h2>{show.title}</h2><p>{show.artist} · {show.status}</p></div><button type="button" aria-label="关闭演出详情" onClick={onClose}>×</button></header>
      <div className="v3-demo-detail-body"><div className="v3-demo-detail-art">{show.src ? <img src={show.src} alt={show.title+"海报"} />:<span>LIVE MEMORY</span>}</div><dl><dt>日期</dt><dd>{show.date}</dd><dt>城市</dt><dd>{show.city}</dd><dt>场馆</dt><dd>{show.venue || "待补充"}</dd><dt>数据范围</dt><dd>仅当前演示页面</dd></dl></div>
      <footer><button type="button" onClick={onClose}>返回</button><button type="button" className="v3-demo-primary" onClick={onEdit}>编辑演示记录</button></footer>
    </section>
  </div>;
}

export function DemoInfo({ kind, shows, onClose }: {
  kind:"import"|"share"; shows:DemoShow[]; onClose:()=>void;
}) {
  const ref=useDialogBehavior({onClose,focusSelector:'button[aria-label="关闭演示说明"]'});
  return <div ref={ref} className="v3-demo-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="v3-demo-modal" role="dialog" aria-modal="true" aria-label={kind==="share"?"分享预览":"导入说明"}>
      <header><div><span>{kind==="share"?"SHARE DESIGN":"SAFE IMPORT"}</span><h2>{kind==="share"?"个人回顾卡构图":"导入尚未接入真实数据"}</h2><p>{kind==="share"?"只使用当前演示的公开记录，不包含个人私密字段。":"为防止将私人记录输入公开预览，演示入口不读取文件。正式版将通过安全数据导入服务提供此功能。"}</p></div><button type="button" aria-label="关闭演示说明" onClick={onClose}>×</button></header>
      {kind==="share"&&<div className="v3-demo-share"><span>LIVE MEMORY · THE MOMENTS</span><h3>每一场现场，都是一段记忆</h3><strong>{shows.length} <small>场演出</small></strong><div>{shows.slice(0,3).map(show=><figure key={show.id}>{show.src&&<img src={show.src} alt={show.title}/>}</figure>)}</div><small>DESIGN PREVIEW · NO PRIVATE DATA</small></div>}
      <footer><button type="button" className="v3-demo-primary" onClick={onClose}>返回预览</button></footer>
    </section>
  </div>;
}
