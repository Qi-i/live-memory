import { ArrowRight, CheckCircle2, Github, Loader2, ShieldCheck, UserRound } from "lucide-react";
import {
  FormEvent,
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppSettings, defaultSettings, validatePassword, validateUsername } from "./domain";
import { readSettings, writeSettings } from "./storage";
import {
  currentUser,
  signInWithGithub,
  signInWithPassword,
  signOut,
  signUpOnly,
  watchAccountAuth,
} from "./supabase";

const GUEST_SESSION_KEY = "live-memory-guest-session";

type AccountUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
export type AccessMode = "loading" | "signed-out" | "guest" | "account";

interface AccessContextValue {
  mode: AccessMode;
  user: AccountUser | null;
  enterGuest: () => void;
  leaveGuest: () => void;
  signOutAndReturn: () => Promise<void>;
}

const AccessContext = createContext<AccessContextValue>({
  mode: "loading",
  user: null,
  enterGuest: () => undefined,
  leaveGuest: () => undefined,
  signOutAndReturn: async () => undefined,
});

function userText(user: AccountUser, ...keys: string[]) {
  const metadata = (user.user_metadata || {}) as Record<string, unknown>;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function validSavedUsername(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9]{4,32}$/.test(normalized) ? normalized : "";
}

function normalizedProviderUsername(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32);
  return /^[a-z0-9]{4,32}$/.test(normalized) ? normalized : "";
}

function settingsForSessionUser(settings: AppSettings, user: AccountUser) {
  const providerUsername = userText(user, "user_name", "preferred_username", "username")
    || user.email?.split("@")[0]
    || "";
  const username = validSavedUsername(settings.account.username)
    || normalizedProviderUsername(providerUsername)
    || "user0000";
  const nickname = userText(user, "nickname", "name", "full_name")
    || settings.account.nickname
    || providerUsername
    || username;
  const avatarUrl = userText(user, "avatar_url", "picture") || settings.account.avatarUrl;
  return writeSettings({
    ...settings,
    account: { ...settings.account, username, nickname, avatarUrl },
  });
}

function settingsForCredentials(username: string, nickname?: string) {
  const settings = readSettings();
  return writeSettings({
    ...settings,
    account: {
      ...settings.account,
      username: validateUsername(username),
      nickname: nickname?.trim() || settings.account.nickname || username,
    },
  });
}

export function AccessGate({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AccessMode>("loading");
  const [user, setUser] = useState<AccountUser | null>(null);

  useEffect(() => {
    let active = true;

    const applyUser = (sessionUser: AccountUser | null) => {
      if (!active) return;
      if (sessionUser) {
        sessionStorage.removeItem(GUEST_SESSION_KEY);
        settingsForSessionUser(readSettings(), sessionUser);
        setUser(sessionUser);
        setMode("account");
      } else {
        setUser(null);
        setMode(sessionStorage.getItem(GUEST_SESSION_KEY) === "1" ? "guest" : "signed-out");
      }
    };

    const bootstrap = async () => {
      try {
        applyUser(await currentUser(readSettings()));
      } catch {
        applyUser(null);
      }
    };
    void bootstrap();

    let stopWatching: () => void = () => undefined;
    try {
      stopWatching = watchAccountAuth(readSettings(), (sessionUser) => {
        window.setTimeout(() => applyUser(sessionUser), 0);
      });
    } catch {
      // Keep the login screen available if the account service is temporarily unreachable.
    }

    return () => {
      active = false;
      stopWatching();
    };
  }, []);

  const enterGuest = () => {
    sessionStorage.setItem(GUEST_SESSION_KEY, "1");
    setUser(null);
    setMode("guest");
  };

  const leaveGuest = () => {
    sessionStorage.removeItem(GUEST_SESSION_KEY);
    setUser(null);
    setMode("signed-out");
  };

  const signOutAndReturn = async () => {
    await signOut(readSettings());
    sessionStorage.removeItem(GUEST_SESSION_KEY);
    setUser(null);
    setMode("signed-out");
  };

  const contextValue = useMemo<AccessContextValue>(() => ({
    mode,
    user,
    enterGuest,
    leaveGuest,
    signOutAndReturn,
  }), [mode, user]);

  if (mode === "loading") {
    return <div className="access-loading" role="status"><Loader2 className="spin" /><span>正在打开现场记…</span></div>;
  }

  if (mode === "signed-out") {
    return (
      <AccessContext.Provider value={contextValue}>
        <LoginGate
          onGuest={enterGuest}
          onGithub={() => signInWithGithub(readSettings()).then(() => undefined)}
          onLogin={async (username, password) => {
            validatePassword(password);
            const settings = settingsForCredentials(username);
            await signInWithPassword(settings, password);
            const sessionUser = await currentUser(settings);
            if (!sessionUser) throw new Error("登录没有完成，请刷新页面后再试。");
            settingsForSessionUser(settings, sessionUser);
            setUser(sessionUser);
            setMode("account");
          }}
          onRegister={async (nickname, username, password) => {
            if (!nickname.trim()) throw new Error("请填写昵称。");
            validatePassword(password);
            const settings = settingsForCredentials(username, nickname);
            await signUpOnly(settings, password);
            const sessionUser = await currentUser(settings);
            if (!sessionUser) throw new Error("账号已经创建，但登录没有完成，请刷新后再试。");
            settingsForSessionUser(settings, sessionUser);
            setUser(sessionUser);
            setMode("account");
          }}
        />
      </AccessContext.Provider>
    );
  }

  return <AccessContext.Provider value={contextValue}>{children}</AccessContext.Provider>;
}

const demoCards = [
  ["zhou-shen.webp", "周深", "郑州"],
  ["xue-zhiqian.webp", "薛之谦", "洛阳"],
  ["zhang-jie.jpg", "张杰", "乌鲁木齐"],
  ["wang-sulong.jpg", "汪苏泷", "郑州"],
  ["zhao-lei.png", "赵雷", "西安"],
] as const;

function demoAsset(file: string) {
  return `${import.meta.env.BASE_URL}demo/${file}`;
}

function accessMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/failed to fetch|network|connection|load failed|closed/i.test(message)) {
    return "暂时无法连接账号服务。请刷新页面后重试；访客示例仍可正常查看。";
  }
  if (/invalid login credentials|用户名或密码/i.test(message)) return "用户名或密码不正确。";
  return message || "操作没有完成，请稍后重试。";
}

function LoginGate({
  onGuest,
  onGithub,
  onLogin,
  onRegister,
}: {
  onGuest: () => void;
  onGithub: () => Promise<void>;
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (nickname: string, username: string, password: string) => Promise<void>;
}) {
  const [registering, setRegistering] = useState(false);
  const [nickname, setNickname] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(accessMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(() => registering
      ? onRegister(nickname, username, password)
      : onLogin(username, password));
  }

  return (
    <main className="access-shell">
      <section className="access-showcase" aria-label="示例演出记录">
        <header className="access-brand-line">
          <span className="access-logo">演</span>
          <div><strong>现场记</strong><small>演出记录 · 票根收藏</small></div>
        </header>

        <div className="access-copy">
          <span>把每次现场留在这里</span>
          <h1>整理演出、海报、票根和照片。</h1>
          <p>按时间、城市和艺人查看自己的观演记录，也可以生成适合分享的图片。</p>
        </div>

        <div className="access-poster-wall">
          {demoCards.map(([file, artist, city], index) => (
            <figure key={file} className={`access-poster-card poster-${index + 1}`}>
              <img src={demoAsset(file)} alt={`${artist}演出海报`} />
              <figcaption><strong>{artist}</strong><span>{city}</span></figcaption>
            </figure>
          ))}
        </div>

        <div className="access-benefits">
          <span><CheckCircle2 />多种档案视图</span>
          <span><CheckCircle2 />票根与照片分类保存</span>
          <span><CheckCircle2 />可选个人云端同步</span>
        </div>
      </section>

      <section className="access-card">
        <header>
          <span>{registering ? "创建账号" : "欢迎回来"}</span>
          <h2>{registering ? "创建现场记账号" : "登录现场记"}</h2>
          <p>{registering ? "创建后可保存个人资料，并按需连接自己的 Supabase。" : "使用之前创建的用户名和密码，或直接使用 GitHub。"}</p>
        </header>

        <form onSubmit={submit}>
          {registering && (
            <label><span>昵称</span><input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="页面上显示的名字" autoComplete="nickname" /></label>
          )}
          <label><span>用户名</span><input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))} placeholder="4–32 位英文字母或数字" autoComplete="username" /></label>
          <label><span>密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" autoComplete={registering ? "new-password" : "current-password"} /></label>
          {message && <p className="access-error" role="alert">{message}</p>}
          <button className="access-primary" disabled={busy || !username || !password || (registering && !nickname)} type="submit">
            {busy ? <Loader2 className="spin" /> : <ShieldCheck />}{registering ? "创建并登录" : "登录"}
          </button>
        </form>

        <div className="access-divider"><span>或</span></div>
        <button className="access-github" disabled={busy} type="button" onClick={() => void run(onGithub)}><Github />使用 GitHub 登录</button>

        <button className="access-switch" type="button" onClick={() => { setRegistering((value) => !value); setMessage(""); }}>
          {registering ? "已有账号，返回登录" : "第一次使用？创建账号"}
        </button>

        <div className="access-guest">
          <div><UserRound /><span><strong>先看看示例</strong><small>内置 5 条公开演出示例；你的修改不会保存，也不会读取个人记录。</small></span></div>
          <button type="button" onClick={onGuest}>进入示例<ArrowRight /></button>
        </div>

        <p className="access-footnote">登录账号用于识别你；只有主动连接个人 Supabase 后，图片才会跨设备同步。</p>
      </section>
    </main>
  );
}

export function useAccess() {
  return useContext(AccessContext);
}

export function isGuestSession() {
  return sessionStorage.getItem(GUEST_SESSION_KEY) === "1";
}

export function makeGuestSettings(): AppSettings {
  return {
    ...defaultSettings,
    onboardingComplete: true,
    storageMode: "local",
    account: { username: "guest", nickname: "访客", avatarUrl: "", recoveryEmail: "" },
    supabase: { url: "", anonKey: "", mediaBucket: "echo-media", syncMedia: false, ownerKey: "" },
  };
}
