const SIMPLE_USERNAME_RE = /^[a-z0-9]{4,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const accountUrl = import.meta.env.VITE_ACCOUNT_SUPABASE_URL || "";
const accountAnonKey = import.meta.env.VITE_ACCOUNT_SUPABASE_ANON_KEY || "";

export function normalizeLoginIdentifier(value: string) {
  return value.trim().toLowerCase();
}

export function validateLoginIdentifier(value: string) {
  const identifier = normalizeLoginIdentifier(value);
  if (!SIMPLE_USERNAME_RE.test(identifier) && !EMAIL_RE.test(identifier)) {
    throw new Error("请输入有效的用户名或已绑定邮箱");
  }
  return identifier;
}

export async function resolveLoginUsername(value: string) {
  const identifier = validateLoginIdentifier(value);
  if (SIMPLE_USERNAME_RE.test(identifier)) return identifier;

  if (!accountUrl || !accountAnonKey) {
    throw new Error("账号服务暂时不可用，请稍后再试");
  }

  let response: Response;
  try {
    response = await fetch(`${accountUrl.replace(/\/+$/, "")}/rest/v1/rpc/echo_resolve_login_username`, {
      method: "POST",
      headers: {
        apikey: accountAnonKey,
        authorization: `Bearer ${accountAnonKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ input_identifier: identifier }),
    });
  } catch {
    throw new Error("暂时无法连接账号服务，请刷新页面后重试。");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 404 || /PGRST202|function.*does not exist|schema cache/i.test(detail)) {
      throw new Error("账号服务需要更新，请稍后再试。");
    }
    throw new Error("暂时无法连接账号服务，请刷新页面后重试。");
  }

  const resolved = await response.json().catch(() => null);
  if (typeof resolved !== "string" || !SIMPLE_USERNAME_RE.test(resolved)) {
    throw new Error("用户名或密码不正确。");
  }
  return resolved;
}
