import { useMemo, useState } from "react";
import { ActionToolbar, MapSplitPane, StageHero, WorkspaceShell, type StatusHistoryItem } from "./WorkspaceShell";
import { DemoArchiveView, DemoDetail, DemoEditor, DemoInfo, DemoStatistics } from "./DemoViews";
import { demoShows, type DemoShow } from "./demoData";
import type { SyncActivity } from "../../core/sync/policy";
import "./preview.css";

const navigation = ["档案", "统计", "地图", "设置", "管理"] as const;
type Page = typeof navigation[number];
const modes = ["海报", "时间线", "城市/场馆", "汇总", "列表"] as const;
type Mode = typeof modes[number];
type Dialog = { type: "detail" | "editor" | "import" | "share"; showId?: string } | null;

const markerPositions: Record<string, { x: number; y: number }> = {
  乌鲁木齐: { x: 23, y: 43 }, 北京: { x: 69, y: 30 },
  郑州: { x: 57, y: 54 }, 洛阳: { x: 51, y: 62 },
  西安: { x: 42, y: 72 },
};

function PreviewMap({
  cities, onCity, selectedCity,
}: {
  cities: Array<{ city: string; count: number }>;
  selectedCity: string | null;
  onCity: (city: string) => void;
}) {
  return (
    <div className="v3-preview-map" aria-label="演示城市分布示意图，非真实地图底图">
      <span className="v3-preview-map-overline">MEMORY MAP · DEMONSTRATION</span>
      <strong>城市足迹示意</strong>
      <p>图中位置仅用于交互验证；正式版接入真实地理数据与地图组件。</p>
      {cities.map(({ city, count }, index) => {
        const location = markerPositions[city] ?? { x: 19 + (index * 17) % 62, y: 39 + (index * 13) % 42 };
        return (
          <div key={city} className="v3-preview-map-marker" style={{ left: location.x + "%", top: location.y + "%" }}>
            <button type="button" aria-label={"查看" + city + "演出"} aria-pressed={selectedCity === city}
              onClick={() => onCity(city)}>{count}</button>
            <small>{city}</small>
          </div>
        );
      })}
    </div>
  );
}

export function V3Preview() {
  const [shows, setShows] = useState<DemoShow[]>(() => demoShows.map((show) => ({ ...show })));
  const [page, setPage] = useState<Page>("档案");
  const [mode, setMode] = useState<Mode>("城市/场馆");
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [activity, setActivity] = useState<SyncActivity>({ type: "idle" });
  const [activityHistory, setActivityHistory] = useState<StatusHistoryItem[]>([]);
  const [showExtra, setShowExtra] = useState(false);
  const [material, setMaterial] = useState<"liquid" | "editorial">("liquid");

  const visibleShows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return !query ? shows : shows.filter((show) =>
      [show.title, show.artist, show.city, show.venue, show.date, show.status]
        .some((value) => value.toLocaleLowerCase().includes(query)));
  }, [shows, search]);
  const cityRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const show of visibleShows) counts.set(show.city, (counts.get(show.city) ?? 0) + 1);
    return [...counts].map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "zh"));
  }, [visibleShows]);
  const seen = visibleShows.filter((show) => show.status === "已看").length;
  const selectedShow = dialog?.showId ? shows.find((show) => show.id === dialog.showId) : undefined;
  const cityShows = selectedCity ? visibleShows.filter((show) => show.city === selectedCity) : [];
  const selectPage = (next: Page) => { setPage(next); setSelectedCity(null); };
  const showMap = page === "地图" || (page === "档案" && mode === "城市/场馆");
  const openDetail = (show: DemoShow) => setDialog({ type: "detail", showId: show.id });
  const saveDemo = (show: DemoShow) => {
    setShows((records) => records.some((item) => item.id === show.id)
      ? records.map((item) => item.id === show.id ? show : item)
      : [show, ...records]);
  };
  const simulate = (next: SyncActivity) => {
    setActivity(next);
    setActivityHistory((history) => [
      { id: "demo-" + Date.now() + "-" + history.length, time: "本次模拟", activity: next },
      ...history,
    ].slice(0, 8));
  };
  const reset = () => { setShows(demoShows.map((show) => ({ ...show }))); setSearch(""); setSelectedCity(null); };
  const renderMap = () => (
    <MapSplitPane
      map={<PreviewMap cities={cityRows} selectedCity={selectedCity} onCity={setSelectedCity} />}
      detail={selectedCity && (
        <section className="v3-preview-city-detail" role="dialog" aria-label={selectedCity + "的演出"}>
          <header>
            <div><span>城市 · {cityShows.length} 场演出</span><strong>{selectedCity}</strong>
              <small>仅展示属于该城市的演示记录</small></div>
            <button type="button" aria-label="关闭城市详情" onClick={() => setSelectedCity(null)}>×</button>
          </header>
          <div className="v3-preview-city-gallery">
            {cityShows.map((show) => (
              <button type="button" key={show.id} onClick={() => openDetail(show)} aria-label={"查看" + show.title}>
                <div className="v3-preview-city-image">
                  {show.src ? <img src={show.src} alt={show.title + "海报"} loading="lazy" /> : <span>LIVE MEMORY</span>}
                </div>
                <strong>{show.title}</strong>
                <small>{show.date} · {show.status}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      list={<div className="v3-preview-city-list">
        <header><span>FOOTPRINTS · {cityRows.length} CITIES</span><h2>常去城市</h2>
          <p>所有数字均从当前演示记录实时计算</p></header>
        {cityRows.map(({ city, count }) => (
          <button key={city} type="button" aria-pressed={selectedCity === city}
            onClick={() => setSelectedCity(city)}>
            <strong>{city}</strong>
            <span className="v3-preview-city-bar"><i style={{ width: (count / Math.max(1, visibleShows.length)) * 100 + "%" }} /></span>
            <b>{count}</b>
          </button>
        ))}
        <footer>
          <span>足迹概览</span><strong>{cityRows.length} 座城市 · {visibleShows.length} 场演出</strong>
          <button type="button" onClick={() => selectPage("统计")}>查看观演统计</button>
        </footer>
      </div>}
    />
  );

  return (
    <WorkspaceShell
      appearance={material}
      demoStatus
      brand={<><span className="v3-preview-brand">◈</span> Live Memory <small>V3 · 独立演示</small></>}
      navigation={navigation.map((item) =>
        <button key={item} type="button" aria-current={item === page ? "page" : undefined}
          onClick={() => selectPage(item)}>{item}</button>)}
      mobileNavigation={navigation.slice(0, 4).map((item) =>
        <button key={item} type="button" aria-current={item === page ? "page" : undefined}
          onClick={() => selectPage(item)}>{item}</button>)}
      toolbar={<div className="v3-preview-topbar">
        <div><span>LIVE MEMORY / V3 · DEMO</span><strong>{page === "档案" ? "演出档案" : page} · 新工作区</strong>
          <small className="v3-preview-disclosure">独立演示 · 不读取账号、私人云或本机档案</small></div>
        <div className="v3-preview-topbar-stats" aria-label="当前演示数据统计">
          <b>{visibleShows.length} <small>记录</small></b>
          <b>{seen} <small>已看</small></b>
          <b>{cityRows.length} <small>城市</small></b>
        </div>
        <button type="button" onClick={() => simulate({ type: "transferred", direction: "pull", changedRecords: 2 })}>模拟云端更新</button>
        <button type="button" onClick={() => simulate({ type: "conflict", count: 1 })}>模拟冲突</button>
      </div>}
      activity={activity}
      activityHistory={activityHistory}
      account={<span>公开演示 · 未连接个人账号</span>}
      overlay={dialog && (
        dialog.type === "editor"
          ? <DemoEditor key={dialog.showId ?? "new"} existing={selectedShow}
              onClose={() => setDialog(null)} onSave={saveDemo} />
          : dialog.type === "detail" && selectedShow
            ? <DemoDetail key={selectedShow.id} show={selectedShow}
                onClose={() => setDialog(null)}
                onEdit={() => setDialog({ type: "editor", showId: selectedShow.id })} />
            : dialog.type === "import" || dialog.type === "share"
              ? <DemoInfo kind={dialog.type} shows={visibleShows} onClose={() => setDialog(null)} />
              : null
      )}
    >
      {page === "档案" && <>
        <StageHero
          eyebrow="LIVE MEMORY · EXPERIENCE LIBRARY"
          title="把现场，留在时间里"
          description="每张海报都保留完整的竖版比例。搜索、编辑和统计均来自同一份临时演示数据。"
          posters={visibleShows.map(({ id, title, city, src }) => ({ id, title, city, src }))}
        />
        <ActionToolbar
          search={<input aria-label="搜索演出" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索艺人、场馆、城市、日期…" />}
          modes={modes.map((item) =>
            <button key={item} type="button" aria-pressed={mode === item}
              onClick={() => { setMode(item); setSelectedCity(null); }}>{item}</button>)}
          actions={<>
            <button type="button" onClick={() => setShowExtra((value) => !value)} aria-expanded={showExtra}>
              {showExtra ? "收起更多" : "更多操作"}</button>
            <button type="button" onClick={() => setDialog({ type: "import" })}>导入</button>
            <button type="button" onClick={() => setDialog({ type: "editor" })}>新增记录</button>
            {showExtra && <>
              <button type="button" onClick={() => setDialog({ type: "share" })}>分享预览</button>
              <button type="button" onClick={() => selectPage("管理")}>管理演示数据</button>
            </>}
          </>}
        />
        {showMap ? renderMap() :
          <DemoArchiveView mode={mode} shows={visibleShows} onOpen={openDetail} />}
      </>}
      {page === "地图" && <>
        <section className="v3-preview-section-lead"><span>MEMORY MAP</span><h1>城市与演出足迹</h1>
          <p>点击城市标记或右侧列表，查看属于该城市的演出记录。</p></section>
        {renderMap()}
      </>}
      {page === "统计" && <DemoStatistics shows={visibleShows} onShare={() => setDialog({ type: "share" })} />}
      {page === "设置" && <section className="v3-demo-panel v3-preview-settings">
        <header><span>APPEARANCE · DEMO</span><h2>外观与工作区</h2>
          <p>材质切换仅影响当前预览，不会改动正式版的设置。</p></header>
        <div className="v3-preview-theme-options">
          <button type="button" aria-pressed={material === "liquid"} onClick={() => setMaterial("liquid")}>
            <strong>Liquid Stage</strong><small>渐变光场、透明玻璃、悬浮表面</small></button>
          <button type="button" aria-pressed={material === "editorial"} onClick={() => setMaterial("editorial")}>
            <strong>Editorial</strong><small>纯净纸面、低透明度、高可读性</small></button>
        </div>
        <p className="v3-preview-note">正式版的数据迁移、离线保存与跨设备同步仍在独立安全验证中。</p>
      </section>}
      {page === "管理" && <section className="v3-demo-panel v3-preview-management">
        <header><span>SAFE SANDBOX · MANAGEMENT</span><h2>演示数据管理</h2>
          <p>本页的新增和编辑仅存于当前浏览器页面内存。刷新页面会恢复初始公开演示数据。</p></header>
        <div className="v3-preview-management-actions">
          <button type="button" onClick={() => setDialog({ type: "editor" })}>新增临时记录</button>
          <button type="button" onClick={reset}>重置演示记录</button>
          <button type="button" onClick={() => setDialog({ type: "import" })}>了解正式导入</button>
        </div>
        <DemoArchiveView mode="列表" shows={shows} onOpen={openDetail} />
      </section>}
    </WorkspaceShell>
  );
}
