import { Github, Loader2, ShieldCheck, UserRound } from "lucide-react";
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

function settingsForSessionUser(settings: AppSettings, user: AccountUser) {
  const username = userText(user, "user_name", "preferred_username", "username")
    || user.email?.split("@")[0]
    || settings.account.username;
  const nickname = userText(user, "nickname", "name", "full_name")
    || username
    || settings.account.nickname;
  const avatarUrl = userText(user, "avatar_url", "picture") || settings.account.avatarUrl;
  return writeSettings({
    ...settings,
    account: {
      ...settings.account,
      username,
      nickname,
      avatarUrl,
    },
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
    const bootstrap = async () => {
      const settings = readSettings();
      try {
        const sessionUser = await currentUser(settings);
        if (!active) return;
        if (sessionUser) {
          settingsForSessionUser(settings, sessionUser);
          sessionStorage.removeItem(GUEST_SESSION_KEY);
          setUser(sessionUser);
          setMode("account");
          return;
        }
      } catch {
        // A failed session lookup is treated as signed out; the login screen remains usable.
      }
      if (!active) return;
      setUser(null);
      setMode(sessionStorage.getItem(GUEST_SESSION_KEY) === "1" ? "guest" : "signed-out");
    };
    void bootstrap();
    return () => {
      active = false;
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
    return (
      <div className="access-loading" role="status">
        <Loader2 className="spin" />
        <span>正在确认登录状态…</span>
      </div>
    );
  }

  if (mode === "signed-out") {
    return (
      <AccessContext.Provider value={contextValue}>
        <LoginGate
          onGuest={enterGuest}
          onGithub={async () => {
            await signInWithGithub(readSettings());
          }}
          onLogin={async (username, password) => {
            validatePassword(password);
            const settings = settingsForCredentials(username);
            await signInWithPassword(settings, password);
            const sessionUser = await currentUser(settings);
            if (!sessionUser) throw new Error("登录未建立有效会话，请重试");
            settingsForSessionUser(settings, sessionUser);
            setUser(sessionUser);
            setMode("account");
          }}
          onRegister={async (nickname, username, password) => {
            if (!nickname.trim()) throw new Error("请输入昵称");
            validatePassword(password);
            const settings = settingsForCredentials(username, nickname);
            await signUpOnly(settings, password);
            const sessionUser = await currentUser(settings);
            if (!sessionUser) throw new Error("账号已创建，但未建立会话，请检查 Supabase 邮箱验证设置");
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
      setMessage(error instanceof Error ? error.message : "操作失败，请稍后重试");
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
      <section className="access-brand-panel">
        <div className="access-logo"><span>演</span></div>
        <p>LIVE MEMORY</p>
        <h1>回响册</h1>
        <strong>你的演出档案应当只在明确身份下打开。</strong>
        <div className="access-points">
          <span>登录后显示真实头像与账户状态</span>
          <span>个人 Supabase 负责跨设备完整同步</span>
          <span>访客模式不读取、不写入你的正式档案</span>
        </div>
      </section>

      <section className="access-card">
        <header>
          <span>{registering ? "创建账号" : "账号登录"}</span>
          <h2>{registering ? "建立 Live Memory 账号" : "继续进入回响册"}</h2>
          <p>未登录时不会展示现有档案、头像或云同步状态。</p>
        </header>

        <form onSubmit={submit}>
          {registering && (
            <label>
              <span>昵称</span>
              <input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="页面显示名称" autoComplete="nickname" />
            </label>
          )}
          <label>
            <span>用户名</span>
            <input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))} placeholder="4–32 位英文字母或数字" autoComplete="username" />
          </label>
          <label>
            <span>密码</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" autoComplete={registering ? "new-password" : "current-password"} />
          </label>
          {message && <p className="access-error">{message}</p>}
          <button className="access-primary" disabled={busy || !username || !password || (registering && !nickname)} type="submit">
            {busy ? <Loader2 className="spin" /> : <ShieldCheck />}
            {registering ? "创建并登录" : "登录账号"}
          </button>
        </form>

        <button className="access-github" disabled={busy} type="button" onClick={() => void run(onGithub)}>
          <Github />
          使用 GitHub 登录
        </button>

        <div className="access-switch">
          <button type="button" onClick={() => { setRegistering((value) => !value); setMessage(""); }}>
            {registering ? "已有账号，返回登录" : "没有账号，创建一个"}
          </button>
        </div>

        <div className="access-guest">
          <div>
            <UserRound />
            <span><strong>访客临时模式</strong><small>仅保存在当前页面内，刷新或关闭后清空，不接触正式档案。</small></span>
          </div>
          <button type="button" onClick={onGuest}>临时进入</button>
        </div>
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
    account: {
      username: "guest",
      nickname: "访客",
      avatarUrl: "",
      recoveryEmail: "",
    },
    supabase: {
      url: "",
      anonKey: "",
      mediaBucket: "echo-media",
      syncMedia: false,
      ownerKey: "",
    },
  };
}
