import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AdminUserRecord {
  id: string;
  email: string;
  username: string;
  displayName: string;
  nickname: string;
  avatarUrl: string;
  recoveryEmail: string;
  githubUsername: string;
  githubUserId: string;
  providers: string[];
  createdAt: string;
  confirmedAt: string;
  lastSignInAt: string;
  updatedAt: string;
  profileUpdatedAt: string;
  recordCount: number;
  linkedCloud: boolean;
  mediaBucket: string;
  syncMedia: boolean;
  isAdmin: boolean;
}

export interface AdminUserProfileInput {
  username: string;
  displayName: string;
  nickname: string;
  recoveryEmail: string;
}

let client: SupabaseClient | null = null;

function adminClient() {
  if (client) return client;
  const url = import.meta.env.VITE_ACCOUNT_SUPABASE_URL || "";
  const key = import.meta.env.VITE_ACCOUNT_SUPABASE_ANON_KEY || "";
  if (!url || !key) throw new Error("账号服务配置缺失");
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      storageKey: "live-memory-account-session",
    },
  });
  return client;
}

async function invokeAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const supabase = adminClient();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("登录状态已失效，请重新登录");

  const response = await supabase.functions.invoke("admin-users", {
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (response.error) throw response.error;
  if (response.data?.error) throw new Error(response.data.error);
  return response.data as T;
}

export async function fetchAdminUsers() {
  const data = await invokeAdmin<{ users: AdminUserRecord[] }>({ action: "list" });
  return Array.isArray(data.users) ? data.users : [];
}

export async function updateAdminUserProfile(userId: string, input: AdminUserProfileInput) {
  return invokeAdmin<{ success: true }>({
    action: "update_profile",
    userId,
    profile: input,
  });
}

export async function resetAdminUserPassword(userId: string, password: string) {
  return invokeAdmin<{ success: true }>({
    action: "reset_password",
    userId,
    password,
  });
}
