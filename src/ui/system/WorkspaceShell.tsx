import type { ReactNode } from "react";
import { useId, useState } from "react";
import type { SyncActivity, SyncPresentation } from "../../core/sync/policy";
import { presentSyncActivity } from "../../core/sync/policy";
import "./workspace.css";

export interface StatusHistoryItem {
  id: string;
  time: string;
  activity: SyncActivity;
}

/**
 * Nonblocking status: the center is part of the persistent sidebar, NOT
 * inserted above the main document where it would shift the archive.
 */
export function StatusCenter({
  current,
  history = [],
}: {
  current: SyncActivity;
  history?: StatusHistoryItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const historyId = useId();
  const presentation: SyncPresentation = presentSyncActivity(current);
  const alert = presentation.surface === "attention";
  return (
    <section className={"v3-status-center" + (alert ? " is-attention" : "")} aria-label="数据同步状态">
      <button
        type="button"
        className="v3-status-trigger"
        aria-label="查看同步状态"
        aria-expanded={expanded}
        aria-controls={historyId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="v3-status-indicator" aria-hidden="true" />
        <span className="v3-status-copy">
          <strong>{alert ? presentation.label : "数据状态中心"}</strong>
          <small>{alert ? "需要处理" : presentation.surface === "silent" ? "本机档案与云端状态" : presentation.label}</small>
        </span>
        <span aria-hidden="true" className="v3-status-chevron">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div id={historyId} className="v3-status-history">
          <h3>同步记录</h3>
          <div className={"v3-status-current" + (alert ? " is-attention" : "")} role={alert ? "alert" : "status"}>
            <strong>当前状态</strong><span>{presentation.label}</span>
          </div>
          {history.length ? (
            <ol>
              {history.slice(0, 8).map((entry) => {
                const row = presentSyncActivity(entry.activity);
                return (
                  <li key={entry.id}>
                    <time>{entry.time}</time>
                    <span>{row.label}</span>
                  </li>
                );
              })}
            </ol>
          ) : <p>暂无需要处理的历史记录。</p>}
        </div>
      )}
    </section>
  );
}

/** Space ownership is explicit: shell, persistent sidebar, toolbar, workspace, overlay. */
export function WorkspaceShell({
  brand,
  navigation,
  mobileNavigation,
  account,
  toolbar,
  activity,
  activityHistory,
  children,
  overlay,
}: {
  brand: ReactNode;
  navigation: ReactNode;
  mobileNavigation?: ReactNode;
  account?: ReactNode;
  toolbar: ReactNode;
  activity: SyncActivity;
  activityHistory?: StatusHistoryItem[];
  children: ReactNode;
  overlay?: ReactNode;
}) {
  return (
    <div className="v3-workspace-shell" data-ui-system="v3">
      <aside className="v3-sidebar" aria-label="应用导航">
        <div className="v3-sidebar-brand">{brand}</div>
        <nav className="v3-sidebar-navigation" aria-label="主导航">{navigation}</nav>
        <div className="v3-sidebar-utility">
          <StatusCenter current={activity} history={activityHistory} />
          {account && <div className="v3-sidebar-account">{account}</div>}
        </div>
      </aside>
      <div className="v3-workspace-column">
        <header className="v3-global-toolbar">{toolbar}</header>
        <main className="v3-workspace-content" id="v3-workspace-content">{children}</main>
      </div>
      {mobileNavigation && (
        <nav className="v3-mobile-navigation" aria-label="手机主导航">
          {mobileNavigation}
          <div className="v3-mobile-status"><StatusCenter current={activity} history={activityHistory} /></div>
        </nav>
      )}
      {overlay && <div className="v3-overlay-host">{overlay}</div>}
    </div>
  );
}

/** Original portrait source remains fully legible; only the frame may crop. */
export function PortraitArtwork({
  src,
  alt,
  caption,
  className = "",
  priority = false,
}: {
  src?: string;
  alt: string;
  caption?: ReactNode;
  className?: string;
  priority?: boolean;
}) {
  return (
    <figure className={"v3-portrait-artwork " + className}>
      <div className="v3-portrait-frame">
        {src ? <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" /> : <span aria-hidden="true">LIVE</span>}
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

export interface StagePoster {
  id: string;
  src?: string;
  title: string;
  city?: string;
}

/** Independent horizontal gallery; a portrait is never constrained by a 100px-tall strip. */
export function StageHero({
  eyebrow,
  title,
  description,
  posters,
}: {
  eyebrow: string;
  title: string;
  description: string;
  posters: StagePoster[];
}) {
  return (
    <section className="v3-stage-hero">
      <div className="v3-stage-hero-copy">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="v3-stage-hero-gallery" aria-label="演出海报画廊">
        {posters.map((poster, index) => (
          <PortraitArtwork
            priority={index < 3}
            key={poster.id}
            src={poster.src}
            alt={poster.title + "海报"}
            caption={<><strong>{poster.title}</strong>{poster.city && <small>{poster.city}</small>}</>}
          />
        ))}
      </div>
    </section>
  );
}

/** The map has one geometry owner. The side list and the map always stretch to equal height. */
export function MapSplitPane({
  map,
  list,
  detail,
  className = "",
}: {
  map: ReactNode;
  list: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <section className={"v3-map-split " + className}>
      <div className="v3-map-stage">
        <div className="v3-map-fill">{map}</div>
        {detail && <div className="v3-map-detail-layer">{detail}</div>}
      </div>
      <aside className="v3-map-side" aria-label="城市与场馆列表">{list}</aside>
    </section>
  );
}

/** Search, view modes and context actions wrap as groups before controls get clipped. */
export function ActionToolbar({
  search,
  modes,
  actions,
}: {
  search: ReactNode;
  modes: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="v3-action-toolbar">
      <div className="v3-toolbar-search">{search}</div>
      <div className="v3-toolbar-modes">{modes}</div>
      <div className="v3-toolbar-actions">{actions}</div>
    </div>
  );
}
