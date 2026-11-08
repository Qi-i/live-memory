import { useMemo, useState } from "react";
import {
  ActionToolbar, MapSplitPane, StageHero, WorkspaceShell,
  type StagePoster, type StatusHistoryItem,
} from "./WorkspaceShell";
import type { SyncActivity } from "../../core/sync/policy";
import { seedRecords } from "../../seeds";
import "./preview.css";

const cityCounts = [
  ["乌鲁木齐", 15], ["北京", 9], ["郑州", 4], ["福州", 1],
  ["合肥", 1], ["洛阳", 1], ["太原", 1], ["天津", 1], ["武汉", 1], ["西安", 1],
] as const;

const history: StatusHistoryItem[] = [
  { id: "a", time: "刚刚", activity: { type: "connected" } },
  { id: "b", time: "上一次同步", activity: { type: "transferred", direction: "push", changedRecords: 2 } },
];

const posters: StagePoster[] = seedRecords
  .filter((record) => record.media.some((asset) => asset.kind === "poster"))
  .slice(0, 8)
  .map((record) => ({
    id: record.id,
    title: record.title,
    city: record.city,
    src: record.media.find((asset) => asset.kind === "poster")?.src,
  }));

const navigation = ["档案", "统计", "地图", "设置", "管理"];
const modes = ["海报", "时间线", "城市/场馆", "汇总", "列表"];

function PreviewMap({ onCity }: { onCity: (city: string) => void }) {
  return (
    <div className="v3-preview-map" aria-label="地图几何预览，非实时地图">
      <span className="v3-preview-map-overline">MEMORY MAP · LAYOUT PREVIEW</span>
      <strong>地图布局验证</strong>
      <p>真实地图组件将在适配器迁移后接入；此处只检查面板等高、弹层和滚动约束。</p>
      <div className="v3-preview-map-marker is-west"><button type="button" onClick={() => onCity("乌鲁木齐")}>15</button><small>乌鲁木齐</small></div>
      <div className="v3-preview-map-marker is-north"><button type="button" onClick={() => onCity("北京")}>9</button><small>北京</small></div>
      <div className="v3-preview-map-marker is-middle"><button type="button" onClick={() => onCity("郑州")}>4</button><small>郑州</small></div>
      <div className="v3-preview-map-marker is-east"><button type="button" onClick={() => onCity("福州")}>1</button><small>福州</small></div>
    </div>
  );
}

export function V3Preview() {
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedMode, setSelectedMode] = useState("城市/场馆");
  const [activity, setActivity] = useState<SyncActivity>({ type: "connected" });
  const [showExtra, setShowExtra] = useState(false);
  const filteredPosters = useMemo(() => posters.filter((poster) =>
    !search.trim() || (poster.title + poster.city).toLowerCase().includes(search.toLowerCase()),
  ), [search]);

  return (
    <WorkspaceShell
      brand={<><span className="v3-preview-brand">◈</span> Live Memory <small>V3 · 结构验证</small></>}
      navigation={navigation.map((item) =>
        <button key={item} type="button" aria-current={item === "档案" ? "page" : undefined}>{item}</button>)}
      mobileNavigation={navigation.slice(0, 4).map((item) =>
        <button key={item} type="button" aria-current={item === "档案" ? "page" : undefined}>{item}</button>)}
      toolbar={
        <div className="v3-preview-topbar">
          <div><span>ARCHIVE / V3</span><strong>演出档案 · 新工作区原型</strong></div>
          <div className="v3-preview-topbar-stats"><b>35 <small>记录</small></b><b>33 <small>已看</small></b><b>10 <small>城市</small></b></div>
          <button type="button" onClick={() => setActivity({ type: "transferred", direction: "pull", changedRecords: 2 })}>模拟云端更新</button>
          <button type="button" onClick={() => setActivity({ type: "conflict", count: 1 })}>模拟冲突</button>
        </div>
      }
      activity={activity}
      activityHistory={history}
      account={<span>示例档案 · 不连接个人账号</span>}
    >
      <StageHero
        eyebrow="LIVE MEMORY · EXPERIENCE LIBRARY"
        title="把现场，留在时间里"
        description="海报与回忆拥有自己的空间，而不是被塞成一条狭窄横幅。"
        posters={filteredPosters}
      />
      <ActionToolbar
        search={<input aria-label="搜索演出" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索艺人、场次、城市…" />}
        modes={modes.map((mode) =>
          <button key={mode} type="button" aria-pressed={selectedMode === mode} onClick={() => setSelectedMode(mode)}>{mode}</button>)}
        actions={<>
          <button type="button" onClick={() => setShowExtra((value) => !value)}>{showExtra ? "收起更多" : "更多操作"}</button>
          <button type="button">导入</button>
          <button type="button">新增记录</button>
          {showExtra && <button type="button">生成分享图</button>}
        </>}
      />
      <MapSplitPane
        map={<PreviewMap onCity={setSelectedCity} />}
        detail={selectedCity && (
          <div className="v3-preview-city-detail" role="dialog" aria-label={selectedCity + "的演出"}>
            <header><div><span>城市</span><strong>{selectedCity}</strong><small>从右侧列表或地图标记打开</small></div><button type="button" aria-label="关闭城市详情" onClick={() => setSelectedCity(null)}>×</button></header>
            <div className="v3-preview-city-gallery">
              {filteredPosters.slice(0, 7).map((poster) => (
                <article key={poster.id}>
                  <div className="v3-preview-city-image">{poster.src ? <img src={poster.src} alt={poster.title} loading="lazy" /> : "LIVE"}</div>
                  <strong>{poster.title}</strong>
                  <small>{poster.city || "演出城市"}</small>
                </article>
              ))}
            </div>
          </div>
        )}
        list={
          <div className="v3-preview-city-list">
            <header><span>FOOTPRINTS</span><h2>常去城市</h2><p>排名与地图始终共用同一高度约束。</p></header>
            {cityCounts.map(([city, count], i) => (
              <button key={city} type="button" aria-pressed={selectedCity === city} onClick={() => setSelectedCity(city)}>
                <strong>{city}</strong><span className="v3-preview-city-bar"><i style={{ width: (count / 15) * 100 + "%" }} /></span><b>{count}</b>
                <span className="v3-preview-city-number">{String(i + 1).padStart(2, "0")}</span>
              </button>
            ))}
          </div>
        }
      />
    </WorkspaceShell>
  );
}
