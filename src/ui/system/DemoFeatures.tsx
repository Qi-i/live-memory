import { useState, type FormEvent, type ReactNode } from "react";
import type { DemoShow } from "./demoData";
import { PortraitArtwork } from "./WorkspaceShell";
import { useDialogBehavior } from "../useDialogBehavior";
import "./demoFeatures.css";

export type DemoView = "海报" | "时间线" | "城市/场馆" | "汇总" | "列表";
export type DemoPage = "档案" | "统计" | "地图" | "设置" | "管理";

function PanelTitle({ eyebrow, title, description, aside }: {
  eyebrow: string; title: string; description: string; aside?: ReactNode;
}) {
  return <header className="v3-demo-heading">
    <div><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
    {aside}
  </header>;
}

export function DemoGallery({ shows, onOpen }: {
  shows: DemoShow[]; onOpen: (show: DemoShow) => void;
}) {
  return <section className="v3-demo-panel">
    <PanelTitle eyebrow="POSTER LIBRARY" title="现场海报档案"
      description="点击海报查看详情。原始海报保持竖版比例，不裁成横条。" aside={<small>{shows.length} 场</small>} />
    {shows.length ? <div className="v3-demo-gallery-grid">{shows.map(show => (
      <button className="v3-demo-poster-link" type="button" key={show.id} onClick={() => onOpen(show)} aria-label={"查看：" + show.title}>
        <PortraitArtwork src={show.src} alt={show.title + "海报"} caption={
          <><strong>{show.title}</strong><small>{show.city} · {show.date}</small></>
        } />
      </button>
    ))}</div> : <DemoEmpty />}
  </section>;
}

function DemoEmpty() {
  return <div className="v3-demo-empty">没有符合当前条件的演出。可以清空搜索条件或新增演示记录。</div>;
}

export function DemoTimeline({ shows, onOpen }: {
  shows: DemoShow[]; onOpen: (show: DemoShow) => void;
}) {
  const rows = [...shows].sort((a, b) => b.date.localeCompare(a.date));
  return <section className="v3-demo-panel">
    <PanelTitle eyebrow="TIMELINE" title="按时间回看每场现场"
      description="时间线以演出日期为序，不改变实际记录的排列。" aside={<small>{rows.length} 场</small>} />
    {rows.length ? <ol className="v3-demo-timeline">{rows.map(show => (
      <li key={show.id}>
        <time dateTime={show.date}>{show.date}</time>
        <button type="button" onClick={() => onOpen(show)}><strong>{show.title}</strong><span>{show.city} · {show.venue}</span></button>
        <span className="v3-demo-state">{show.status}</span>
      </li>
    ))}</ol> : <DemoEmpty />}
  </section>;
}

export function DemoList({ shows, onOpen }: {
  shows: DemoShow[]; onOpen: (show: DemoShow) => void;
}) {
  return <section className="v3-demo-panel">
    <PanelTitle eyebrow="DETAIL TABLE" title="演出记录总览"
      description="清晰列出艺人、场馆、日期与状态，点击记录进入详情。" aside={<small>{shows.length} 场</small>} />
    {shows.length ? <div className="v3-demo-table-wrap"><table className="v3-demo-table">
      <thead><tr><th>演出</th><th>艺人</th><th>城市</th><th>日期</th><th>状态</th></tr></thead>
      <tbody>{shows.map(show => <tr key={show.id}>
        <td><button type="button" onClick={() => onOpen(show)}>{show.title}</button></td>
        <td>{show.artist}</td><td>{show.city}</td><td>{show.date}</td><td>{show.status}</td>
      </tr>)}</tbody>
    </table></div> : <DemoEmpty />}
  </section>;
}

export function DemoStatistics({ shows }: { shows: DemoShow[] }) {
  const attended = shows.filter(s => s.status === "已看");
  const years = new Map<string, number>();
  const cities = new Map<string, number>();
  const artists = new Map<string, number>();
  for (const show of attended) {
    years.set(show.date.slice(0, 4), (years.get(show.date.slice(0, 4)) ?? 0) + 1);
    cities.set(show.city, (cities.get(show.city) ?? 0) + 1);
    artists.set(show.artist, (artists.get(show.artist) ?? 0) + 1);
  }
  const rankedCities = [...cities.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rankedCities.map(row => row[1]));
  return <section className="v3-demo-panel">
    <PanelTitle eyebrow="MEMORY INSIGHTS" title="观演画像"
      description="统计仅来自当前演示档案，已看与待看分别计算；不使用真实个人数据。" />
    <div className="v3-demo-metrics">
      <article><strong>{shows.length}</strong><span>演示记录</span></article>
      <article><strong>{attended.length}</strong><span>已看演出</span></article>
      <article><strong>{cities.size}</strong><span>已到访城市</span></article>
      <article><strong>{artists.size}</strong><span>已看艺人</span></article>
    </div>
    <div className="v3-demo-stats-panels">
      <div><h3>城市足迹</h3>{rankedCities.length ? rankedCities.map(([city, count]) =>
        <div key={city} className="v3-demo-stat-row"><span>{city}</span><div><i style={{width:(count/max)*100+"%"}} /></div><strong>{count}</strong></div>)
        : <p>暂无已完成的现场。</p>}</div>
      <div><h3>年度观演</h3>{[...years.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([year,count]) =>
        <div key={year} className="v3-demo-stat-row"><span>{year}</span><div><i style={{width:count/Math.max(1,...years.values())*100+"%"}} /></div><strong>{count}</strong></div>)}
        {!years.size && <p>暂无已完成的现场。</p>}</div>
    </div>
  </section>;
}

export function DemoPreferences({ style, onStyleChange, count, onReset }: {
  style: "liquid" | "editorial"; onStyleChange:(style:"liquid"|"editorial")=>void;
  count:number; onReset:()=>void;
}) {
  return <section className="v3-demo-panel">
    <PanelTitle eyebrow="WORKSPACE SETTINGS" title="工作区设计"
      description="外观实时切换，演示修改只存在于当前浏览器标签页中。" />
    <div className="v3-demo-preference-grid">
      <button type="button" aria-pressed={style==="liquid"} onClick={()=>onStyleChange("liquid")}>
        <strong>Liquid Stage</strong><span>光场渐变与玻璃材质</span><small>{style==="liquid"?"当前主题":"切换主题"}</small>
      </button>
      <button type="button" aria-pressed={style==="editorial"} onClick={()=>onStyleChange("editorial")}>
        <strong>Editorial</strong><span>低透明度的画册布局</span><small>{style==="editorial"?"当前主题":"切换主题"}</small>
      </button>
    </div>
    <div className="v3-demo-safety"><h3>关于本演示</h3>
      <p>当前有 {count} 条演示记录。新增、编辑、海报上传均只影响这一次页面会话；刷新后恢复演示内容。不连接账号、云服务或个人数据库。正式版后续会接入受保护的数据仓库。</p>
      <button type="button" onClick={onReset}>恢复初始演示记录</button>
    </div>
  </section>;
}

export function DemoDetail({ show, onClose, onEdit }: {
  show:DemoShow; onClose:()=>void; onEdit:()=>void;
}) {
  const ref = useDialogBehavior({onClose,focusSelector:'button[aria-label="关闭详情"]'});
  return <div className="v3-demo-backdrop" ref={ref} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="v3-demo-detail" role="dialog" aria-modal="true" aria-label={"演出详情："+show.title}>
      <button type="button" className="v3-demo-close" aria-label="关闭详情" onClick={onClose}>×</button>
      <div className="v3-demo-detail-poster"><PortraitArtwork src={show.src} alt={show.title+"海报"} /></div>
      <div className="v3-demo-detail-info">
        <span>LIVE MEMORY · DEMO DETAIL</span><h2>{show.title}</h2>
        <dl><dt>艺人</dt><dd>{show.artist}</dd><dt>演出日期</dt><dd>{show.date}</dd>
          <dt>城市</dt><dd>{show.city}</dd><dt>场馆</dt><dd>{show.venue}</dd>
          <dt>状态</dt><dd>{show.status}</dd></dl>
        <p>这是演示记录。编辑仅影响当前预览会话，不会修改个人云或正式档案。</p>
        <button type="button" className="v3-demo-primary" onClick={onEdit}>编辑这场演出</button>
      </div>
    </section>
  </div>;
}

export function DemoEditor({ initial, onClose, onSave }: {
  initial: DemoShow|null; onClose:()=>void; onSave:(show:DemoShow)=>void;
}) {
  const [draft,setDraft] = useState<DemoShow>(initial ?? {
    id: "demo-added-"+crypto.randomUUID(), title:"", artist:"", city:"",venue:"",
    date:"2026-11-09",status:"待看",
  });
  const [discard,setDiscard] = useState(false);
  const dirty = JSON.stringify(draft)!==JSON.stringify(initial ?? {
    id:draft.id,title:"",artist:"",city:"",venue:"",date:"2026-11-09",status:"待看",
  });
  const requestClose=()=>{if(dirty)setDiscard(true);else onClose()};
  const ref=useDialogBehavior({onClose:requestClose,focusSelector:'input[name="title"]'});
  const update=(key:keyof DemoShow,value:string)=>
    setDraft(current=>({...current,[key]:value}));
  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!draft.title.trim()||!draft.date||!draft.city.trim())return;
    onSave({...draft,title:draft.title.trim(),artist:draft.artist.trim(),city:draft.city.trim(),venue:draft.venue.trim()});
  };
  return <div className="v3-demo-backdrop" ref={ref}>
    <section className="v3-demo-edit" role="dialog" aria-modal="true" aria-label={initial?"编辑演示演出":"新增演示演出"}>
      <header><div><span>RECORD STUDIO · IN-MEMORY ONLY</span><h2>{initial?"编辑演出":"新增演出记录"}</h2><p>只修改演示数据，不写入个人账户。</p></div>
        <button type="button" className="v3-demo-close" aria-label="关闭编辑器" onClick={requestClose}>×</button></header>
      <form onSubmit={submit}>
        <div className="v3-demo-edit-fields">
          <label className="is-wide">演出名称<input name="title" required value={draft.title} onChange={e=>update("title",e.target.value)} placeholder="例：城市音乐现场" /></label>
          <label>艺人 / 乐队<input value={draft.artist} onChange={e=>update("artist",e.target.value)} placeholder="艺人或组合" /></label>
          <label>演出日期<input type="date" required value={draft.date} onChange={e=>update("date",e.target.value)} /></label>
          <label>城市<input required value={draft.city} onChange={e=>update("city",e.target.value)} placeholder="北京" /></label>
          <label>场馆<input value={draft.venue} onChange={e=>update("venue",e.target.value)} placeholder="现场场馆" /></label>
          <label>观演状态<select value={draft.status} onChange={e=>update("status",e.target.value)}>
            <option value="待看">待看</option><option value="已看">已看</option>
          </select></label>
          <label className="is-wide">本地海报（仅此页面会话）
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{
              const file=e.target.files?.[0];if(file)update("src",URL.createObjectURL(file));
            }} />
          </label>
        </div>
        {discard&&<div className="v3-demo-warning" role="alert"><p>这次修改尚未保存。确定要放弃吗？</p>
          <button type="button" onClick={()=>setDiscard(false)}>继续编辑</button>
          <button type="button" onClick={onClose}>放弃修改</button></div>}
        <footer><button type="button" onClick={requestClose}>取消</button><button type="submit" className="v3-demo-primary">保存演示记录</button></footer>
      </form>
    </section>
  </div>;
}

export function DemoShare({ source, onClose, onDownload }: {
  source:string;onClose:()=>void;onDownload:()=>void;
}) {
  const ref=useDialogBehavior({onClose,focusSelector:'button[aria-label="关闭分享预览"]'});
  return <div ref={ref} className="v3-demo-backdrop">
    <section role="dialog" aria-modal="true" aria-label="个人回顾分享图" className="v3-demo-share">
      <header><div><span>4:5 · 1080 × 1350</span><h2>分享图片预览</h2><p>内容仅使用当前演示记录，导出不会连接账号。</p></div>
        <button type="button" className="v3-demo-close" aria-label="关闭分享预览" onClick={onClose}>×</button></header>
      <img src={source} alt="演示观演回顾分享卡" />
      <button type="button" className="v3-demo-primary" onClick={onDownload}>保存 PNG 图片</button>
    </section>
  </div>;
}
