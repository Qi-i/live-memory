# Supabase 配置指南

## 1. 创建项目

登录 Supabase，创建一个新项目。数据库密码只用于管理和可信服务端，不要填写到回响册或提交到 GitHub。

## 2. 初始化数据库和图片桶

打开 `SQL Editor > New query`，粘贴并执行仓库中的：

```text
supabase/migrations/001_echo_archive.sql
supabase/migrations/002_account_profiles.sql
```

执行成功后应看到：

- `Table Editor` 中有 `echo_records`、`echo_media_assets`、`echo_user_profiles`。
- `Storage` 中有私有 bucket `echo-media`。
- 三张表都已启用 RLS。
- `storage.objects` 与三张业务表均有 owner 策略。

不要把 bucket 改为 Public。票根、座位和现场照片可能包含个人信息，私有 bucket 才会在读取时执行访问控制。

## 3. 获取前端连接参数

在项目设置的 API 页面复制：

- Project URL。
- anon key 或 publishable key。

把它们放进本地 `.env.local`：

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_KEY
VITE_SUPABASE_MEDIA_BUCKET=echo-media
```

anon/publishable key 可以出现在前端；真正的数据边界来自 RLS。`service_role` key 能绕过 RLS，绝不能放进前端、GitHub Actions 变量或公开截图。

## 4. 设置登录

在 `Authentication > Providers` 保留 Email。若开启“确认邮箱”，首次注册后要先点击确认邮件，再回到应用登录。

当前 UI 的“登录/注册”逻辑会先尝试登录；账号不存在时再注册。建议个人使用时创建一个强密码，并为 Supabase 账号开启多因素认证。

回响册的“网站账号”使用 Supabase Auth。密码只由 Supabase Auth 保存和校验，应用自己的 `echo_user_profiles` 表不会保存密码，只保存当前登录用户的显示名、GitHub 标识、绑定的 Supabase URL/anon key、媒体桶和常用地图 Key。

### 保存自己的账号绑定

1. 在应用 `设置 > 数据保存位置` 选择“我的 Supabase”。
2. 填写 Project URL、anon/public key、媒体桶和邮箱密码。
3. 点击“登录/注册”。
4. 如需把当前账号和 GitHub 绑定，点击“GitHub 登录”完成授权后回到应用。
5. 点击“保存账号绑定”。这会在 `echo_user_profiles` 中写入一行 `user_id = 当前登录用户` 的私有配置。
6. 换设备后，先填同一个 Supabase 项目的 URL 和 anon key，登录同一账号，再点击“读取账号绑定”。

不要在 `echo_user_profiles` 或任何前端配置里保存 `service_role`、数据库密码、对象存储 Secret、GitHub OAuth Client Secret。它们属于服务端密钥。

### 可选：GitHub 登录

GitHub 登录仍然是 Supabase Auth 的一种登录方式。它不会把演出记录保存到 GitHub，也不会让不同 GitHub 用户看到彼此的数据。

1. 在 Supabase `Authentication > Sign In / Providers > GitHub` 复制 Callback URL，格式通常是 `https://<project-ref>.supabase.co/auth/v1/callback`。
2. 在 GitHub `Settings > Developer settings > OAuth Apps` 注册一个 OAuth App。
3. `Homepage URL` 填回响册站点，例如 `https://qi-i.github.io/live-memory/`。
4. `Authorization callback URL` 填 Supabase 提供的 Callback URL。
5. 把 GitHub OAuth App 的 Client ID 和 Client Secret 填回 Supabase 的 GitHub Provider 并保存。
6. 在 Supabase `Authentication > URL Configuration` 中，将回响册站点地址加入允许跳转地址；本地调试可额外加入 `http://127.0.0.1:5173/`。

配置完成后，应用设置页的“GitHub 登录”按钮会跳转到 GitHub 授权，再回到当前回响册站点。

## 5. 第一次同步

1. 先在“备份”页导出 JSON。
2. 在“设置”页填写 URL、key 和媒体桶。
3. 用邮箱密码或 GitHub 登录。
4. 登录成功后点击“推送我的数据”。
5. 打开 Supabase Table Editor 和 Storage，确认记录与图片已出现。
6. 在另一台设备打开应用，用同一账号登录，点击“拉取我的数据”。

## 健康检查

设置页会显示本地记录、媒体数量、本地未上传图片、远端图片和最近同步时间。首次推送后，“本地未上传图片”应下降；外部海报 URL 不会被自动复制到 Storage。

## 常见问题

### `new row violates row-level security policy`

通常是未登录、登录会话过期，或 SQL 没有完整执行。确认 `auth.users` 中有当前用户，并重新登录。

### `Bucket not found`

统一检查三个位置都为 `echo-media`：SQL 创建的 bucket、`.env.local`、应用设置页。

### 第二个账号无法导入相同示例 ID

当前 migration 使用 `(user_id, id)` 复合主键，不同用户可以拥有相同本地记录 ID。若你执行过更早的单列主键 SQL，请新建项目或手工迁移主键后再同步。

### 图片链接过一段时间失效

私有图片使用短期签名 URL。重新“拉取我的数据”会生成新地址；正式的后台同步版本应在图片加载失败时自动续签。

### 免费空间不够

应用上传前会将长边限制到 1800px。仍然不足时，优先只同步精选照片，把原图留在相册或硬盘；进一步方案见 [存储与发布策略](./storage-and-publishing.md)。
