from pathlib import Path
import re


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"missing exact block in {path}: {old[:100]!r}")
    text = text.replace(old, new, 1)
    p.write_text(text, encoding="utf-8")


def sub_once(path: str, pattern: str, replacement: str, flags=0):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"expected one regex replacement in {path}, got {count}: {pattern[:100]}")
    p.write_text(next_text, encoding="utf-8")

# --- supabase.ts: explicit post-login personal-cloud status + immediate media signing ---
replace_once(
    "src/supabase.ts",
    '''export interface PostLoginSyncResult {\n  settings: AppSettings;\n  records: EventRecord[];\n  message: string;\n}\n''',
    '''export type PersonalCloudRecoveryStatus = "not-configured" | "connected" | "reconnect-needed";\n\nexport interface PostLoginSyncResult {\n  settings: AppSettings;\n  records: EventRecord[];\n  message: string;\n  personalCloudStatus: PersonalCloudRecoveryStatus;\n}\n''',
)
replace_once(
    "src/supabase.ts",
    '''  // 2. Personal Supabase: restore saved project settings, then reconnect using the Live Memory account.\n  if (nextSettings.storageMode === "supabase" && hasSupabaseConfig(nextSettings)) {\n    try {\n      const connected = await signInStorageWithAccount(nextSettings);\n      nextSettings = connected.settings;\n      messages.push("个人云端已连接");\n    } catch {\n      messages.push("个人云端配置已恢复");\n    }\n  }\n''',
    '''  // 2. Personal Supabase: restore saved project settings, then reconnect using the Live Memory account.\n  // A transient cold-start/network failure must remain visible to the controller so it can retry later.\n  let personalCloudStatus: PersonalCloudRecoveryStatus = "not-configured";\n  if (nextSettings.storageMode === "supabase" && hasSupabaseConfig(nextSettings)) {\n    try {\n      const connected = await signInStorageWithAccount(nextSettings);\n      nextSettings = connected.settings;\n      personalCloudStatus = "connected";\n      messages.push("个人云端已连接");\n    } catch {\n      personalCloudStatus = "reconnect-needed";\n      messages.push("个人云端待恢复");\n    }\n  }\n''',
)
replace_once(
    "src/supabase.ts",
    '''  return {\n    settings: nextSettings,\n    records: nextRecords,\n    message: messages.join("，") || "同步完成",\n  };\n}\n''',
    '''  // 4. Once the saved personal project is connected, immediately renew media URLs.\n  // This is intentionally after text recovery so restored local storage paths are signed too.\n  if (personalCloudStatus === "connected" && nextSettings.supabase.syncMedia) {\n    try {\n      nextRecords = await refreshSignedMediaUrls(nextSettings, nextRecords, { force: true });\n      messages.push("云端图片已恢复");\n    } catch {\n      personalCloudStatus = "reconnect-needed";\n      messages.push("云端图片待恢复");\n    }\n  }\n\n  return {\n    settings: nextSettings,\n    records: nextRecords,\n    message: messages.join("，") || "同步完成",\n    personalCloudStatus,\n  };\n}\n''',
)

# --- appController.ts: bounded retries and truthful status ---
replace_once(
    "src/appController.ts",
    '''  saveUserProfileBinding,\n  syncAfterLogin,\n} from "./supabase";\nimport type { SyncConflict } from "./supabase";\n''',
    '''  saveUserProfileBinding,\n  signInStorageWithAccount,\n  syncAfterLogin,\n} from "./supabase";\nimport type { PersonalCloudRecoveryStatus, SyncConflict } from "./supabase";\n''',
)
replace_once(
    "src/appController.ts",
    '''  const [cloudRecoveryNotice, setCloudRecoveryNotice] = useState("");\n  const [busy, setBusy] = useState(false);\n''',
    '''  const [cloudRecoveryNotice, setCloudRecoveryNotice] = useState("");\n  const [personalCloudStatus, setPersonalCloudStatus] = useState<PersonalCloudRecoveryStatus>("not-configured");\n  const [busy, setBusy] = useState(false);\n''',
)
replace_once(
    "src/appController.ts",
    '''  const syncOperationInFlight = useRef(false);\n''',
    '''  const syncOperationInFlight = useRef(false);\n  const personalCloudRecoveryInFlight = useRef(false);\n''',
)
replace_once(
    "src/appController.ts",
    '''            nextRecords = initialSync.records;\n            nextSettings = writeSettings({ ...initialSync.settings, onboardingComplete: true });\n            await replaceAllRecords(nextRecords);\n''',
    '''            nextRecords = initialSync.records;\n            nextSettings = writeSettings({ ...initialSync.settings, onboardingComplete: true });\n            setPersonalCloudStatus(initialSync.personalCloudStatus);\n            if (initialSync.personalCloudStatus === "reconnect-needed") {\n              setCloudRecoveryNotice("个人云端连接尚未恢复，系统会在当前页面自动重试；文字档案不受影响。");\n            }\n            await replaceAllRecords(nextRecords);\n''',
)
replace_once(
    "src/appController.ts",
    '''  useEffect(() => () => {\n    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);\n  }, []);\n\n  useEffect(() => {\n''',
    '''  useEffect(() => () => {\n    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);\n  }, []);\n\n  async function recoverPersonalCloud(silent = false) {\n    if (isGuest || !access.user || settings.storageMode !== "supabase" || !hasSupabaseConfig(settings)) {\n      setPersonalCloudStatus("not-configured");\n      return false;\n    }\n    if (hasPersonalCloudConnection(settings) && personalCloudStatus === "connected") return true;\n    if (personalCloudRecoveryInFlight.current) return false;\n    personalCloudRecoveryInFlight.current = true;\n    setPersonalCloudStatus("reconnect-needed");\n    const delays = [0, 650, 1800];\n    let lastError: unknown = null;\n    try {\n      for (const delay of delays) {\n        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));\n        try {\n          const connected = await signInStorageWithAccount(settings);\n          const connectedSettings = writeSettings(connected.settings);\n          let nextRecords = recordsRef.current;\n          if (connectedSettings.supabase.syncMedia) {\n            nextRecords = await refreshSignedMediaUrls(connectedSettings, nextRecords, { force: true });\n            await replaceAllRecords(nextRecords);\n            setRecords(nextRecords);\n            void preloadRecordMedia(nextRecords);\n            lastMediaRefreshAt.current = Date.now();\n          }\n          setSettings(connectedSettings);\n          setPersonalCloudStatus("connected");\n          setCloudRecoveryNotice(connectedSettings.supabase.syncMedia ? "个人云端已经自动恢复，图片链接已重新签名。" : "个人云端已经自动恢复。");\n          if (!silent) flash("个人云端已恢复");\n          return true;\n        } catch (error) {\n          lastError = error;\n        }\n      }\n      setPersonalCloudStatus("reconnect-needed");\n      if (!silent && lastError) flash(friendlySupabaseErrorMessage(lastError, "个人云端恢复失败"));\n      return false;\n    } finally {\n      personalCloudRecoveryInFlight.current = false;\n    }\n  }\n\n  useEffect(() => {\n    if (isGuest || !access.user || settings.storageMode !== "supabase" || !hasSupabaseConfig(settings) || personalCloudStatus === "connected") return;\n    const retryPersonalCloud = () => void recoverPersonalCloud(true);\n    const initial = window.setTimeout(retryPersonalCloud, 1200);\n    window.addEventListener("focus", retryPersonalCloud);\n    window.addEventListener("online", retryPersonalCloud);\n    return () => {\n      window.clearTimeout(initial);\n      window.removeEventListener("focus", retryPersonalCloud);\n      window.removeEventListener("online", retryPersonalCloud);\n    };\n  }, [access.user, isGuest, personalCloudStatus, settings.storageMode, settings.supabase.anonKey, settings.supabase.url]);\n\n  useEffect(() => {\n''',
)
replace_once(
    "src/appController.ts",
    '''    cloudRecoveryNotice,\n    dismissCloudRecoveryNotice: () => setCloudRecoveryNotice(""),\n    syncNow,\n''',
    '''    cloudRecoveryNotice,\n    dismissCloudRecoveryNotice: () => setCloudRecoveryNotice(""),\n    personalCloudStatus,\n    recoverPersonalCloud,\n    syncNow,\n''',
)

# --- AppRoot.tsx: expose recovery state/action in global cloud center ---
replace_once(
    "src/AppRoot.tsx",
    '''    cloudRecoveryNotice,\n    dismissCloudRecoveryNotice,\n    syncNow,\n''',
    '''    cloudRecoveryNotice,\n    dismissCloudRecoveryNotice,\n    personalCloudStatus,\n    recoverPersonalCloud,\n    syncNow,\n''',
)
replace_once(
    "src/AppRoot.tsx",
    '''  const syncLabel = isGuest\n    ? "示例数据"\n    : syncing\n      ? "同步中…"\n      : syncConflicts.length\n        ? `${syncConflicts.length} 条冲突`\n        : hasPersonalCloudConnection(settings)\n          ? "个人云端已连接"\n          : "设备数据";\n''',
    '''  const syncLabel = isGuest\n    ? "示例数据"\n    : personalCloudStatus === "reconnect-needed"\n      ? "个人云端需恢复"\n      : syncing\n        ? "同步中…"\n        : syncConflicts.length\n          ? `${syncConflicts.length} 条冲突`\n          : hasPersonalCloudConnection(settings)\n            ? "个人云端已连接"\n            : "设备数据";\n''',
)
replace_once(
    "src/AppRoot.tsx",
    '''            <button type="button" disabled={syncing || isGuest} onClick={() => void syncNow()}><Cloud />立即同步</button>\n            <button type="button" disabled={syncing || isGuest} onClick={() => void checkRemoteUpdates(false)}><CloudDownload />从云端恢复 / 检查其他设备更新</button>\n            <button type="button" disabled={syncing || isGuest || !settings.supabase.syncMedia} onClick={() => void refreshCloudMedia()}><RefreshCw />刷新云端图片</button>\n            <small>{settings.supabase.syncMedia ? "图片同步已开启；网页恢复可见和网络恢复时也会自动刷新。" : "当前未开启云端图片同步。"}</small>\n''',
    '''            <button type="button" disabled={syncing || isGuest} onClick={() => void syncNow()}><Cloud />立即同步</button>\n            <button type="button" disabled={syncing || isGuest} onClick={() => void checkRemoteUpdates(false)}><CloudDownload />从云端恢复 / 检查其他设备更新</button>\n            {personalCloudStatus === "reconnect-needed" && <button type="button" disabled={syncing || isGuest} onClick={() => void recoverPersonalCloud(false)}><RefreshCw />恢复个人云端</button>}\n            <button type="button" disabled={syncing || isGuest || !settings.supabase.syncMedia} onClick={() => void refreshCloudMedia()}><RefreshCw />刷新云端图片</button>\n            <small>{personalCloudStatus === "reconnect-needed" ? "个人云端连接尚未恢复；系统会在网页重新聚焦或恢复网络时自动重试。" : settings.supabase.syncMedia ? "图片同步已开启；网页恢复可见和网络恢复时也会自动刷新。" : "当前未开启云端图片同步。"}</small>\n''',
)

# --- amap.ts: types needed for custom HTML markers and linked focus ---
replace_once(
    "src/amap.ts",
    '''export interface AMapMarkerInstance {\n  on?: (event: string, handler: () => void) => void;\n}\n\nexport interface AMapMapInstance {\n  add?: (items: AMapMarkerInstance[] | AMapMarkerInstance) => void;\n  setFitView?: (...args: unknown[]) => void;\n  destroy: () => void;\n}\n\nexport interface AMapNamespace {\n  Map: new (container: HTMLElement | string, options?: Record<string, unknown>) => AMapMapInstance;\n  Marker: new (options?: Record<string, unknown>) => AMapMarkerInstance;\n}\n''',
    '''export interface AMapMarkerOptions {\n  position?: [number, number];\n  title?: string;\n  content?: string | HTMLElement;\n  anchor?: string;\n  offset?: unknown;\n  zIndex?: number;\n}\n\nexport interface AMapMarkerInstance {\n  on?: (event: string, handler: (event?: unknown) => void) => void;\n  setContent?: (content: string | HTMLElement) => void;\n  setPosition?: (position: [number, number]) => void;\n}\n\nexport interface AMapMapInstance {\n  add?: (items: AMapMarkerInstance[] | AMapMarkerInstance) => void;\n  setFitView?: (...args: unknown[]) => void;\n  setCenter?: (center: [number, number], immediately?: boolean, duration?: number) => void;\n  setZoomAndCenter?: (zoom: number, center: [number, number], immediately?: boolean, duration?: number) => void;\n  on?: (event: string, handler: (event?: unknown) => void) => void;\n  destroy: () => void;\n}\n\nexport interface AMapNamespace {\n  Map: new (container: HTMLElement | string, options?: Record<string, unknown>) => AMapMapInstance;\n  Marker: new (options?: AMapMarkerOptions) => AMapMarkerInstance;\n}\n''',
)

# --- archive.tsx: grouped poster markers, two-stage picker, ranking linkage ---
p = Path("src/archive.tsx")
text = p.read_text(encoding="utf-8")
start = text.index('function footprintLngLat(')
end = text.index('\n\nfunction PriceView(', start)
replacement = r'''type PlaceMode = "city" | "venue";

type PlaceGroup = {
  key: string;
  label: string;
  count: number;
  heat: number;
  point?: [number, number];
  records: EventRecord[];
};

function placeKey(record: EventRecord, mode: PlaceMode) {
  return mode === "city" ? record.city : [record.city, record.venue].filter(Boolean).join(" · ");
}

function buildPlaceGroups(records: EventRecord[], mode: PlaceMode): PlaceGroup[] {
  const grouped = new Map<string, EventRecord[]>();
  records.forEach((record) => {
    const key = placeKey(record, mode);
    if (!key) return;
    grouped.set(key, [...(grouped.get(key) || []), record]);
  });
  const maxCount = Math.max(1, ...Array.from(grouped.values(), (items) => items.length));
  return Array.from(grouped.entries()).map(([key, items]) => {
    const ordered = [...items].sort((a, b) => b.date.localeCompare(a.date));
    const count = ordered.length;
    const explicit = ordered.find((record) => record.coordinates)?.coordinates;
    const point: [number, number] | undefined = explicit
      ? [explicit.lng, explicit.lat]
      : cityCoordinateFallbacks[ordered[0]?.city || ""];
    return { key, label: key, count, heat: count / maxCount, point, records: ordered };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"));
}

function placeHeatColor(heat: number) {
  const clamped = Math.max(0, Math.min(1, heat));
  const hue = Math.round(178 - clamped * 154);
  const saturation = Math.round(58 + clamped * 18);
  const lightness = Math.round(48 + clamped * 4);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function buildPosterMarkerContent(group: PlaceGroup) {
  const markerContent = document.createElement("button");
  markerContent.type = "button";
  markerContent.className = "amap-poster-marker";
  markerContent.dataset.placeKey = group.key;
  markerContent.dataset.count = String(group.count);
  markerContent.style.setProperty("--heat", String(group.heat));
  markerContent.style.setProperty("--heat-color", placeHeatColor(group.heat));
  markerContent.setAttribute("aria-label", `${group.label} · ${group.count} 场`);
  markerContent.title = `${group.label} · ${group.count} 场`;

  const stack = document.createElement("span");
  stack.className = "amap-poster-stack";
  group.records.slice(0, 3).forEach((record, index) => {
    const frame = document.createElement("span");
    frame.className = "amap-poster-layer";
    frame.style.setProperty("--poster-index", String(index));
    const poster = primaryMedia(record);
    if (poster?.src) {
      const image = document.createElement("img");
      image.src = poster.src;
      image.alt = "";
      image.decoding = "async";
      frame.appendChild(image);
    } else {
      frame.textContent = record.title.slice(0, 1);
    }
    stack.appendChild(frame);
  });
  markerContent.appendChild(stack);

  const badge = document.createElement("span");
  badge.className = "amap-poster-count";
  badge.textContent = String(group.count);
  markerContent.appendChild(badge);
  markerContent.addEventListener("click", (event) => event.stopPropagation());
  return markerContent;
}

function VenueView({ records, mapSettings, onOpenMapSettings, onOpen }: { records: EventRecord[]; mapSettings: AppSettings["map"]; onOpenMapSettings: () => void; onOpen: (record: EventRecord) => void }) {
  const [mode, setMode] = useState<PlaceMode>("city");
  const [selectedPlaceKey, setSelectedPlaceKey] = useState<string | null>(null);
  const [hoveredPlaceKey, setHoveredPlaceKey] = useState<string | null>(null);
  const [focusPlaceKey, setFocusPlaceKey] = useState<string | null>(null);
  const groups = useMemo(() => buildPlaceGroups(records, mode), [mode, records]);

  useEffect(() => {
    setSelectedPlaceKey(null);
    setHoveredPlaceKey(null);
    setFocusPlaceKey(null);
  }, [mode]);

  let mapPanel: ReactNode;
  if (mapSettings.provider === "amap" && !mapSettings.amapKey.trim()) {
    mapPanel = <div className="venue-map-state" data-map-mode="amap-missing-key"><MapIcon /><strong>配置高德 Key 后显示真实足迹底图</strong><p>你已经选择高德地图，但当前设备没有可用的 Web 端 JS API Key。</p><button type="button" onClick={onOpenMapSettings}>配置高德 Key</button></div>;
  } else if (mapSettings.provider === "amap") {
    mapPanel = <AmapFootprintMap
      groups={groups}
      mode={mode}
      mapSettings={mapSettings}
      selectedPlaceKey={selectedPlaceKey}
      hoveredPlaceKey={hoveredPlaceKey}
      focusPlaceKey={focusPlaceKey}
      onSelectPlace={setSelectedPlaceKey}
      onHoverPlace={setHoveredPlaceKey}
      onOpen={onOpen}
    />;
  } else if (mapSettings.provider === "baidu") {
    mapPanel = <div className="venue-map-state" data-map-mode="baidu-not-ready"><MapIcon /><strong>百度地图尚未接入当前足迹视图</strong><p>为避免“切换了但底图没变化”的假状态，这里不再回退到其他地图。</p><button type="button" onClick={onOpenMapSettings}>切换地图来源</button></div>;
  } else {
    mapPanel = <div className="venue-map-art venue-offline-summary" data-map-mode="offline-summary"><div className="venue-map-heading"><span>MEMORY PLACES</span><strong>离线城市摘要</strong><small>无需 API · 只显示已记录城市，不模拟行政边界</small></div><div className="venue-offline-grid">{groups.slice(0, 18).map((group) => <button key={group.key} type="button" style={{ "--weight": group.heat, "--heat-color": placeHeatColor(group.heat) } as CSSProperties} onClick={() => setSelectedPlaceKey(group.key)}><b>{group.label}</b><span>{group.count} 场</span></button>)}</div><button className="venue-enable-map" type="button" onClick={onOpenMapSettings}>启用高德地图</button></div>;
  }

  return (
    <section className="archive-venue-view">
      {mapPanel}
      <div className="venue-ranking">
        <header><span>足迹整理</span><h2>{mode === "city" ? "常去城市" : "常去场馆"}</h2><div><button className={mode === "city" ? "is-active" : ""} type="button" onClick={() => setMode("city")}>城市</button><button className={mode === "venue" ? "is-active" : ""} type="button" onClick={() => setMode("venue")}>场馆</button></div></header>
        <div className="venue-ranking-list">
          {groups.map((group) => <button
            key={group.key}
            type="button"
            className={`${selectedPlaceKey === group.key ? "is-selected " : ""}${hoveredPlaceKey === group.key ? "is-hovered" : ""}`.trim()}
            style={{ "--ratio": `${group.heat * 100}%`, "--heat": group.heat, "--heat-color": placeHeatColor(group.heat) } as CSSProperties}
            onMouseEnter={() => setHoveredPlaceKey(group.key)}
            onMouseLeave={() => setHoveredPlaceKey(null)}
            onClick={() => { setSelectedPlaceKey(group.key); setFocusPlaceKey(group.key); }}
          ><span>{group.label}</span><i /><b>{group.count}</b></button>)}
        </div>
        <div className="venue-heat-legend"><span>低频</span><i /><span>高频</span></div>
      </div>
    </section>
  );
}

function AmapFootprintMap({ groups, mode, mapSettings, selectedPlaceKey, hoveredPlaceKey, focusPlaceKey, onSelectPlace, onHoverPlace, onOpen }: {
  groups: PlaceGroup[];
  mode: PlaceMode;
  mapSettings: AppSettings["map"];
  selectedPlaceKey: string | null;
  hoveredPlaceKey: string | null;
  focusPlaceKey: string | null;
  onSelectPlace: (key: string | null) => void;
  onHoverPlace: (key: string | null) => void;
  onOpen: (record: EventRecord) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AMapMapInstance | null>(null);
  const markerElementsRef = useRef(new Map<string, HTMLElement>());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const selectedGroup = groups.find((group) => group.key === selectedPlaceKey) || null;

  useEffect(() => {
    let disposed = false;
    setStatus("loading");
    markerElementsRef.current.clear();
    loadAmap({ key: mapSettings.amapKey, securityCode: mapSettings.amapSecurityCode })
      .then((AMap) => {
        if (disposed || !hostRef.current) return;
        const map = new AMap.Map(hostRef.current, { center: [104.2, 35.8], zoom: 4.1, viewMode: "2D", resizeEnable: true });
        mapRef.current = map;
        const markers = groups.flatMap((group) => {
          if (!group.point) return [];
          const markerContent = buildPosterMarkerContent(group);
          markerElementsRef.current.set(group.key, markerContent);
          const marker = new AMap.Marker({ position: group.point, title: `${group.label} · ${group.count} 场`, content: markerContent, anchor: "bottom-center", zIndex: 100 + Math.round(group.heat * 100) });
          marker.on?.("click", (event) => {
            const original = (event as { originalEvent?: { stopPropagation?: () => void } } | undefined)?.originalEvent;
            original?.stopPropagation?.();
            onSelectPlace(group.key);
          });
          marker.on?.("mouseover", () => onHoverPlace(group.key));
          marker.on?.("mouseout", () => onHoverPlace(null));
          return [marker];
        });
        map.add?.(markers);
        map.on?.("click", () => onSelectPlace(null));
        if (markers.length) map.setFitView?.(markers, false, [82, 82, 82, 82], 11);
        hostRef.current.dataset.amapReady = "true";
        setStatus("ready");
      })
      .catch(() => { if (!disposed) setStatus("error"); });
    return () => {
      disposed = true;
      markerElementsRef.current.clear();
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, [groups, mapSettings.amapKey, mapSettings.amapSecurityCode, mode]);

  useEffect(() => {
    markerElementsRef.current.forEach((element, key) => {
      element.classList.toggle("is-selected", key === selectedPlaceKey);
      element.classList.toggle("is-hovered", key === hoveredPlaceKey);
    });
  }, [hoveredPlaceKey, selectedPlaceKey]);

  useEffect(() => {
    if (!focusPlaceKey || !mapRef.current) return;
    const group = groups.find((item) => item.key === focusPlaceKey);
    if (group?.point) mapRef.current.setZoomAndCenter?.(6.8, group.point, false, 420);
  }, [focusPlaceKey, groups]);

  return <div className="amap-map-shell" data-map-mode="amap">
    <div className="venue-map-heading"><span>AMAP · MEMORY MAP</span><strong>{mode === "city" ? "城市海报足迹" : "场馆海报足迹"}</strong><small>{status === "ready" ? "点击海报堆选择地点，再点具体海报打开详情" : status === "error" ? "地图加载失败，请检查 Key、安全密钥或域名白名单" : "正在载入高德地图…"}</small></div>
    <div ref={hostRef} className="amap-map-host" data-amap-status={status} />
    <div className="map-heat-legend"><span>低频</span><i /><span>高频</span></div>
    {selectedGroup && <div className="venue-place-picker" data-place-key={selectedGroup.key}>
      <header><div><span>{mode === "city" ? "城市" : "场馆"}</span><strong>{selectedGroup.label}</strong><small>{selectedGroup.count} 场 · 选择海报打开详情</small></div><button type="button" aria-label="关闭地点演出选择" onClick={() => onSelectPlace(null)}>×</button></header>
      <div className={selectedGroup.count === 1 ? "is-single" : "is-multiple"}>
        {selectedGroup.records.map((record) => <button data-archive-record-id={record.id} key={record.id} type="button" onClick={() => onOpen(record)}>
          <span><RecordMedia media={primaryMedia(record)} alt={record.title} fallback={record.title.slice(0, 1)} /></span>
          <section><strong>{record.title}</strong><small>{record.date} · {record.venue || record.city}</small></section>
        </button>)}
      </div>
    </div>}
    {status === "error" ? <button className="venue-enable-map" type="button" onClick={() => window.location.reload()}>重新载入</button> : null}
  </div>;
}
'''
text = text[:start] + replacement + text[end:]
p.write_text(text, encoding="utf-8")

# --- archive.css: shared heat language, poster stack, picker, ranking linkage ---
p = Path("src/archive.css")
css = p.read_text(encoding="utf-8")
css += r'''

/* Poster-cluster venue map */
.amap-map-shell { overflow: hidden; border-radius: 18px; }
.amap-map-host { height: 500px; }
.amap-poster-marker {
  --heat: .2;
  --heat-color: hsl(160 62% 49%);
  position: relative;
  display: block;
  width: 58px;
  height: 78px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  transform: scale(calc(.88 + var(--heat) * .18));
  transform-origin: 50% 100%;
  transition: transform 160ms ease, filter 160ms ease;
  filter: drop-shadow(0 8px 12px rgb(15 23 42 / .22));
}
.amap-poster-marker.is-hovered,
.amap-poster-marker:hover { transform: scale(calc(.98 + var(--heat) * .2)) translateY(-2px); z-index: 20; }
.amap-poster-marker.is-selected { transform: scale(calc(1.04 + var(--heat) * .2)) translateY(-4px); z-index: 30; }
.amap-poster-stack { position: absolute; inset: 0 5px 8px 5px; display: block; }
.amap-poster-layer {
  --poster-index: 0;
  position: absolute;
  inset: 0;
  overflow: hidden;
  border: 2px solid color-mix(in srgb, white 88%, var(--heat-color));
  border-radius: 8px;
  background: color-mix(in srgb, var(--heat-color) 18%, var(--experience-surface-solid));
  color: var(--experience-text);
  font-weight: 800;
  display: grid;
  place-items: center;
  transform: translateX(calc((var(--poster-index) - 1) * 7px)) rotate(calc((var(--poster-index) - 1) * 5deg));
  box-shadow: 0 4px 10px rgb(15 23 42 / .15);
}
.amap-poster-layer:first-child { z-index: 3; transform: none; }
.amap-poster-layer img { width: 100%; height: 100%; object-fit: cover; display: block; }
.amap-poster-count {
  position: absolute;
  right: -4px;
  bottom: 0;
  z-index: 8;
  min-width: 25px;
  height: 25px;
  padding: 0 6px;
  display: grid;
  place-items: center;
  border: 2px solid white;
  border-radius: 99px;
  background: var(--heat-color);
  color: white;
  font-size: 12px;
  font-weight: 900;
  box-shadow: 0 4px 9px rgb(15 23 42 / .22);
}
.amap-poster-marker.is-selected::after {
  content: "";
  position: absolute;
  inset: -7px -10px 0;
  border: 3px solid var(--heat-color);
  border-radius: 13px;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--heat-color) 20%, transparent);
}
.venue-place-picker {
  position: absolute;
  left: 18px;
  bottom: 18px;
  z-index: 7;
  width: min(540px, calc(100% - 36px));
  max-height: 310px;
  overflow: auto;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--experience-border) 82%, white);
  border-radius: 16px;
  background: color-mix(in srgb, var(--experience-surface-solid) 86%, transparent);
  backdrop-filter: blur(22px) saturate(1.18);
  box-shadow: 0 18px 42px rgb(15 23 42 / .20);
}
.venue-place-picker > header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
.venue-place-picker > header div { display: grid; gap: 2px; }
.venue-place-picker > header span { color: var(--experience-accent); font-size: 11px; font-weight: 800; letter-spacing: .08em; }
.venue-place-picker > header strong { font-size: 18px; }
.venue-place-picker > header small { color: var(--experience-muted); }
.venue-place-picker > header > button { border: 0; background: transparent; font-size: 22px; cursor: pointer; color: var(--experience-muted); }
.venue-place-picker > div { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
.venue-place-picker > div.is-single { grid-template-columns: minmax(0, 220px); }
.venue-place-picker > div > button { min-width: 0; padding: 6px; border: 1px solid var(--experience-border); border-radius: 12px; background: color-mix(in srgb, var(--experience-surface-solid) 92%, transparent); text-align: left; cursor: pointer; }
.venue-place-picker > div > button > span { display: block; aspect-ratio: 3 / 4; overflow: hidden; border-radius: 8px; background: color-mix(in srgb, var(--experience-text) 7%, transparent); }
.venue-place-picker > div > button img { width: 100%; height: 100%; object-fit: cover; display: block; }
.venue-place-picker > div > button section { display: grid; gap: 2px; padding: 6px 2px 2px; }
.venue-place-picker > div > button strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.venue-place-picker > div > button small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--experience-muted); font-size: 10px; }
.venue-ranking-list { display: grid; gap: 3px; }
.venue-ranking-list > button {
  --heat-color: var(--experience-accent-2);
  display: grid;
  grid-template-columns: minmax(72px, 1fr) 90px 28px;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 7px 4px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--experience-text);
  text-align: left;
  cursor: pointer;
  transition: background 140ms ease, transform 140ms ease;
}
.venue-ranking-list > button:hover,
.venue-ranking-list > button.is-hovered { background: color-mix(in srgb, var(--heat-color) 9%, transparent); }
.venue-ranking-list > button.is-selected { background: color-mix(in srgb, var(--heat-color) 15%, transparent); transform: translateX(-3px); }
.venue-ranking-list > button span { font-weight: 650; }
.venue-ranking-list > button i { height: 6px; border-radius: 99px; background: linear-gradient(90deg, var(--heat-color) var(--ratio), color-mix(in srgb, var(--experience-text) 8%, transparent) var(--ratio)); }
.venue-ranking-list > button b { text-align: right; }
.venue-heat-legend,
.map-heat-legend { display: flex; align-items: center; gap: 7px; color: var(--experience-muted); font-size: 10px; }
.venue-heat-legend { justify-content: flex-end; padding-top: 8px; }
.venue-heat-legend i,
.map-heat-legend i { width: 82px; height: 5px; border-radius: 99px; background: linear-gradient(90deg, hsl(178 58% 48%), hsl(92 66% 49%), hsl(24 76% 52%)); }
.map-heat-legend { position: absolute; right: 14px; bottom: 14px; z-index: 5; padding: 7px 9px; border-radius: 99px; background: color-mix(in srgb, var(--experience-surface-solid) 84%, transparent); backdrop-filter: blur(12px); }
.venue-offline-grid > button { border-color: color-mix(in srgb, var(--heat-color, var(--experience-accent-2)) 24%, var(--experience-border)); }

@media (max-width: 820px) {
  .amap-map-host { height: 430px; }
  .venue-place-picker { left: 10px; bottom: 10px; width: calc(100% - 20px); max-height: 260px; }
  .venue-ranking-list > button { grid-template-columns: minmax(70px, 1fr) 70px 26px; }
  .map-heat-legend { right: 10px; bottom: 10px; }
}
'''
p.write_text(css, encoding="utf-8")

print("Applied personal cloud reconnect and poster-cluster map implementation")
