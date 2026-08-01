import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const fallbackAdminId = "362b4a40-2545-4002-9ebc-d71b20bd8922";
const adminIds = (Deno.env.get("ADMIN_USER_IDS") || Deno.env.get("ADMIN_USER_ID") || fallbackAdminId)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) return json({ error: "缺少登录凭证" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "服务端配置不完整" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user: requester }, error: requesterError } = await userClient.auth.getUser();
    if (requesterError || !requester || !adminIds.includes(requester.id)) {
      return json({ error: "无权访问管理功能" }, 403);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await request.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "list";

    if (action === "reset_password") {
      const userId = cleanText(body.userId, 80);
      const password = typeof body.password === "string" ? body.password : "";
      if (!userId) return json({ error: "缺少用户 ID" }, 400);
      if (password.length < 10 || password.length > 128) return json({ error: "密码需为 10–128 位" }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action === "update_profile") {
      const userId = cleanText(body.userId, 80);
      const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
      const username = cleanText(profile.username, 32).toLowerCase();
      const displayName = cleanText(profile.displayName, 120);
      const nickname = cleanText(profile.nickname, 120);
      const recoveryEmail = cleanText(profile.recoveryEmail, 254).toLowerCase();
      if (!userId || !/^[a-z0-9]{4,32}$/.test(username)) {
        return json({ error: "用户名需为 4–32 位小写字母或数字" }, 400);
      }
      if (recoveryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)) {
        return json({ error: "备用邮箱格式不正确" }, 400);
      }
      const { error } = await admin
        .from("echo_user_profiles")
        .upsert({
          user_id: userId,
          username,
          display_name: displayName || null,
          nickname: nickname || null,
          recovery_email: recoveryEmail || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    if (action !== "list") return json({ error: "不支持的管理操作" }, 400);

    const authUsers = [];
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
      if (error) return json({ error: error.message }, 400);
      authUsers.push(...data.users);
      if (data.users.length < 100) break;
    }

    const [{ data: profiles, error: profileError }, { data: backups, error: backupError }] = await Promise.all([
      admin.from("echo_user_profiles").select("user_id, username, display_name, nickname, avatar_url, recovery_email, github_username, github_user_id, linked_supabase_url, linked_supabase_media_bucket, preferences, created_at, updated_at"),
      admin.from("echo_text_backups").select("user_id, id, updated_at").is("deleted_at", null),
    ]);
    if (profileError) return json({ error: profileError.message }, 400);
    if (backupError) return json({ error: backupError.message }, 400);

    const profileByUser = new Map((profiles || []).map((profile) => [profile.user_id, profile]));
    const recordCounts = new Map<string, number>();
    for (const backup of backups || []) {
      recordCounts.set(backup.user_id, (recordCounts.get(backup.user_id) || 0) + 1);
    }

    const users = authUsers
      .map((user) => {
        const profile = profileByUser.get(user.id) || {};
        const providers = Array.from(new Set([
          ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []),
          ...(user.identities || []).map((identity) => identity.provider),
        ].filter(Boolean)));
        const preferences = profile.preferences && typeof profile.preferences === "object" ? profile.preferences : {};
        return {
          id: user.id,
          email: user.email || "",
          username: profile.username || user.user_metadata?.username || "",
          displayName: profile.display_name || user.user_metadata?.display_name || user.user_metadata?.full_name || "",
          nickname: profile.nickname || "",
          avatarUrl: profile.avatar_url || user.user_metadata?.avatar_url || "",
          recoveryEmail: profile.recovery_email || "",
          githubUsername: profile.github_username || user.user_metadata?.user_name || "",
          githubUserId: profile.github_user_id || "",
          providers,
          createdAt: user.created_at || profile.created_at || "",
          confirmedAt: user.confirmed_at || "",
          lastSignInAt: user.last_sign_in_at || "",
          updatedAt: user.updated_at || "",
          profileUpdatedAt: profile.updated_at || "",
          recordCount: recordCounts.get(user.id) || 0,
          linkedCloud: Boolean(profile.linked_supabase_url),
          mediaBucket: profile.linked_supabase_media_bucket || "echo-media",
          syncMedia: Boolean(preferences?.supabase?.syncMedia),
          isAdmin: adminIds.includes(user.id),
        };
      })
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    return json({ users });
  } catch (error) {
    console.error("admin-users error", error);
    return json({ error: error instanceof Error ? error.message : "管理服务发生未知错误" }, 500);
  }
});
