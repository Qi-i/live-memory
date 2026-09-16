from pathlib import Path

path = Path('src/supabase.ts')
text = path.read_text(encoding='utf-8')
old = '''let cachedAccountClient: SupabaseClient<LooseDatabase> | null = null;\n\nfunction makeAccountClient(settings: AppSettings) {\n  void settings;\n  const url = accountUrl;\n  const key = accountAnonKey;\n  if (!url || !key) throw new Error("账号服务暂时不可用，请稍后再试");\n  if (!cachedAccountClient) {\n    cachedAccountClient = createClient<LooseDatabase>(url, key, {\n      auth: {\n        persistSession: true,\n        autoRefreshToken: true,\n        storageKey: "live-memory-account-session",\n        detectSessionInUrl: true,\n        flowType: "pkce",\n      },\n    });\n  }\n  return cachedAccountClient;\n}\n'''
new = '''let cachedAccountClient: SupabaseClient<LooseDatabase> | null = null;\n\nexport function getAccountClient() {\n  const url = accountUrl;\n  const key = accountAnonKey;\n  if (!url || !key) throw new Error("账号服务暂时不可用，请稍后再试");\n  if (!cachedAccountClient) {\n    cachedAccountClient = createClient<LooseDatabase>(url, key, {\n      auth: {\n        persistSession: true,\n        autoRefreshToken: true,\n        storageKey: "live-memory-account-session",\n        detectSessionInUrl: true,\n        flowType: "pkce",\n      },\n    });\n  }\n  return cachedAccountClient;\n}\n\nfunction makeAccountClient(settings: AppSettings) {\n  void settings;\n  return getAccountClient();\n}\n'''
if text.count(old) != 1:
    raise SystemExit(f'expected exactly one account client block, found {text.count(old)}')
path.write_text(text.replace(old, new), encoding='utf-8')
