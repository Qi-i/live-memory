import {
  Archive,
  BarChart3,
  Github,
  Menu,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type AppRoute = "archive" | "stats" | "settings" | "admin";
export type AppearanceMode = "system" | "light" | "dark";
export type VisualTheme = "aurora" | "editorial";

export interface ThemeState {
  appearance: AppearanceMode;
  visualTheme: VisualTheme;
}

interface ThemeContextValue extends ThemeState {
  setAppearance: (appearance: AppearanceMode) => void;
  setVisualTheme: (visualTheme: VisualTheme) => void;
  cycleAppearance: () => void;
}

const THEME_STORAGE_KEY = "live-memory-experience-theme-v1";
const defaultTheme: ThemeState = { appearance: "system", visualTheme: "aurora" };
const ThemeContext = createContext<ThemeContextValue>({
  ...defaultTheme,
  setAppearance: () => undefined,
  setVisualTheme: () => undefined,
  cycleAppearance: () => undefined,
});

function readTheme(): ThemeState {
  try {
    const parsed = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || "{}") as Partial<ThemeState>;
    return {
      appearance: parsed.appearance === "light" || parsed.appearance === "dark" || parsed.appearance === "system"
        ? parsed.appearance
        : defaultTheme.appearance,
      visualTheme: parsed.visualTheme === "editorial" || parsed.visualTheme === "aurora"
        ? parsed.visualTheme
        : defaultTheme.visualTheme,
    };
  } catch {
    return defaultTheme;
  }
}

function resolvedAppearance(appearance: AppearanceMode) {
  if (appearance !== "system") return appearance;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ExperienceThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeState>(() => readTheme());

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset.appearance = resolvedAppearance(theme.appearance);
      root.dataset.visualTheme = theme.visualTheme;
      root.style.colorScheme = resolvedAppearance(theme.appearance);
    };
    apply();
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (theme.appearance !== "system" || !media) return;
    media.addEventListener?.("change", apply);
    return () => media.removeEventListener?.("change", apply);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(() => ({
    ...theme,
    setAppearance: (appearance) => setTheme((current) => ({ ...current, appearance })),
    setVisualTheme: (visualTheme) => setTheme((current) => ({ ...current, visualTheme })),
    cycleAppearance: () => setTheme((current) => ({
      ...current,
      appearance: current.appearance === "system" ? "light" : current.appearance === "light" ? "dark" : "system",
    })),
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useExperienceTheme() {
  return useContext(ThemeContext);
}

const routeMeta: Record<AppRoute, { label: string; description: string; icon: ReactNode }> = {
  archive: { label: "档案", description: "浏览和整理演出记录", icon: <Archive /> },
  stats: { label: "统计", description: "查看城市、艺人、时间和票价统计", icon: <BarChart3 /> },
  settings: { label: "设置", description: "管理账号、同步和显示方式", icon: <Settings /> },
  admin: { label: "管理", description: "查看账号和服务使用情况", icon: <ShieldCheck /> },
};

export function routeMetadata(route: AppRoute) {
  return routeMeta[route];
}

export function projectUrl() {
  return "https://github.com/Qi-i/live-memory";
}

export interface ShellMetric {
  value: ReactNode;
  label: string;
}

interface ExperienceShellProps {
  route: AppRoute;
  onRouteChange: (route: AppRoute) => void;
  adminVisible?: boolean;
  accountAvatar: ReactNode;
  accountLabel: string;
  accountSecondary: string;
  accountStatus: ReactNode;
  metrics?: ShellMetric[];
  utilityActions?: ReactNode;
  children: ReactNode;
  shareMode?: boolean;
}

export function ExperienceShell({
  route,
  onRouteChange,
  adminVisible,
  accountAvatar,
  accountLabel,
  accountSecondary,
  accountStatus,
  metrics = [],
  utilityActions,
  children,
  shareMode,
}: ExperienceShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { appearance, cycleAppearance } = useExperienceTheme();
  const meta = routeMetadata(route);
  const routes = (["archive", "stats", "settings", ...(adminVisible ? ["admin"] : [])] as AppRoute[]);

  function navigate(next: AppRoute) {
    onRouteChange(next);
    setMobileNavOpen(false);
  }

  return (
    <div className={`experience-shell${shareMode ? " is-share-mode" : ""}`}>
      <aside className={`experience-rail${mobileNavOpen ? " is-open" : ""}`} aria-label="应用导航">
        <button className="experience-brand" type="button" onClick={() => navigate("archive")}>
          <span className="experience-brand-mark">演</span>
          <span>
            <strong>现场记</strong>
            <small>演出记录</small>
          </span>
        </button>

        <nav className="experience-nav" aria-label="主导航">
          {routes.map((item) => {
            const itemMeta = routeMetadata(item);
            return (
              <button
                className={route === item ? "is-active" : ""}
                key={item}
                type="button"
                onClick={() => navigate(item)}
              >
                {itemMeta.icon}
                <span>{itemMeta.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="experience-rail-utilities">
          <button type="button" title="切换明暗模式" onClick={cycleAppearance}>
            {appearance === "dark" ? <Moon /> : appearance === "light" ? <Sun /> : <span className="system-theme-icon">A</span>}
            <span>外观</span>
          </button>
          <a href={projectUrl()} target="_blank" rel="noreferrer" title="打开 GitHub 项目主页">
            <Github />
            <span>GitHub</span>
          </a>
        </div>

        <button className="experience-profile" type="button" onClick={() => navigate("settings")}>
          {accountAvatar}
          <span>
            <strong>{accountLabel}</strong>
            <small>{accountSecondary}</small>
          </span>
        </button>
      </aside>

      <section className="experience-workspace">
        <header className="experience-topbar">
          <button className="experience-mobile-menu" type="button" aria-label={mobileNavOpen ? "关闭导航" : "打开导航"} onClick={() => setMobileNavOpen((value) => !value)}>
            {mobileNavOpen ? <X /> : <Menu />}
          </button>
          <div className="experience-context">
            <span>{meta.label}</span>
            <h1>{meta.description}</h1>
          </div>
          {metrics.length > 0 && (
            <div className="experience-metrics" aria-label="当前页面摘要">
              {metrics.map((metric) => (
                <strong key={metric.label}>{metric.value}<span>{metric.label}</span></strong>
              ))}
            </div>
          )}
          <div className="experience-status">{accountStatus}</div>
          <div className="experience-actions">{utilityActions}</div>
        </header>

        <main className="experience-content">{children}</main>
      </section>

      <nav className="experience-mobile-nav" aria-label="移动端导航">
        {routes.slice(0, 4).map((item) => {
          const itemMeta = routeMetadata(item);
          return (
            <button className={route === item ? "is-active" : ""} key={item} type="button" onClick={() => navigate(item)}>
              {itemMeta.icon}
              <span>{itemMeta.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export function ThemeSettingsPanel() {
  const { appearance, visualTheme, setAppearance, setVisualTheme } = useExperienceTheme();
  return (
    <section className="theme-settings-panel">
      <header>
        <span>外观</span>
        <h2>页面风格</h2>
        <p>选择明暗模式和页面风格，手机端与分享图会自动适配。</p>
      </header>
      <div className="theme-setting-group">
        <strong>明暗模式</strong>
        <div className="segmented-control">
          {(["system", "light", "dark"] as AppearanceMode[]).map((item) => (
            <button className={appearance === item ? "is-active" : ""} key={item} type="button" onClick={() => setAppearance(item)}>
              {item === "system" ? "跟随系统" : item === "light" ? "浅色" : "深色"}
            </button>
          ))}
        </div>
      </div>
      <div className="theme-setting-group">
        <strong>视觉主题</strong>
        <div className="theme-choice-grid">
          <button className={visualTheme === "aurora" ? "is-active" : ""} type="button" onClick={() => setVisualTheme("aurora")}>
            <i className="theme-preview theme-preview-aurora" />
            <span><b>清透</b><small>留白更轻，适合日常浏览</small></span>
          </button>
          <button className={visualTheme === "editorial" ? "is-active" : ""} type="button" onClick={() => setVisualTheme("editorial")}>
            <i className="theme-preview theme-preview-editorial" />
            <span><b>画册</b><small>排版更突出，适合截图分享</small></span>
          </button>
        </div>
      </div>
    </section>
  );
}
