# Supabase 配置指南

这份指南给第一次接触 Supabase 的用户看。你可以把 Supabase 理解成“自己的私人云端空间”：账号、演出记录和图片都放在那里，电脑和手机用同一个账号登录后就能同步。

GitHub Pages 只是公开应用入口，不会保存你的真实票根和现场照片。

## 1. 创建你的私人云端空间

1. 打开 <https://supabase.com/> 并登录。
2. 点击 `New project`。
3. 填一个容易识别的项目名，例如 `live-memory`。
4. 设置数据库密码。这个密码只给 Supabase 后台使用，不要填到回响册里。
5. 等项目创建完成。

## 2. 初始化记录表和图片空间

在 Supabase 项目里打开 `SQL Editor > New query`，按顺序粘贴并执行仓库中的三个 SQL 文件：

```text
supabase/migrations/001_echo_archive.sql
supabase/migrations/002_account_profiles.sql
supabase/migrations/003_account_identity_fields.sql
```

执行成功后，你应该能看到：

- `Table Editor` 中有 `echo_records`、`echo_media_assets`、`echo_user_profiles`。
- `Storage` 中有私有 bucket `echo-media`。
- 三张表都已启用 RLS。
- `storage.objects` 与三张业务表均有 owner 策略。

不要把 `echo-media` 改成公开。票根、座位图和现场照片可能包含个人信息，保持私有更安全。

## 3. 找到要填进回响册的两项信息

在 Supabase 项目里打开 `Project Settings > API`，复制：

- `Project URL`：填到回响册的“Supabase 项目地址”。
- `anon key` 或 `publishable key`：填到回响册的“公开连接密钥”。

一般用户直接在回响册设置页填写即可。开发者也可以放进本地 `.env.local`：

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_KEY
VITE_SUPABASE_MEDIA_BUCKET=echo-media
```

只复制 `anon` 或 `publishable`。不要复制 `service_role`、数据库密码、GitHub OAuth Client Secret 或对象存储 Secret。

## 4. 设置登录

在 `Authentication > Providers` 保留 Email。若开启“确认邮箱”，首次注册后要先点击确认邮件，再回到应用登录。

当前 UI 的“登录/注册”逻辑会先尝试登录；账号不存在时再注册。建议个人使用时创建一个强密码，并为 Supabase 账号开启多因素认证。

回响册的账号由 Supabase 负责登录和校验密码。应用自己的资料表不会保存密码，只保存昵称、用户名、头像和同步所需的连接信息。

### 第一次打开应用怎么选

如果你完全不懂 Supabase，先记住两句话：

- **本地保存**：最简单。数据只在当前浏览器里，适合先试用；换电脑或换手机前要导出 JSON 备份。
- **登录并同步**：适合电脑和手机都要用。你需要一个 Supabase 项目，登录后每个人只看到自己的数据。

首次引导会让你填写：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| 头像 | 否 | 只用于页面展示，可以先不填 |
| 昵称 | 是 | 页面右上角显示的名字 |
| 用户名 | 是 | 用来识别账号，建议英文、数字、下划线 |
| 密码 | 同步时必填 | 交给 Supabase Auth 保存，应用表里不会保存 |
| 邮箱 | 否 | 填了可用于邮件确认和找回密码；不填则用用户名生成内部登录标识，无法邮件找回 |

如果你的 Supabase 项目开启了邮箱确认，建议填写真实邮箱；否则注册后会收不到确认邮件。

如果选择“登录并同步”，还要填写 Supabase 的连接信息：

| 回响册字段 | Supabase 位置 | 怎么填 |
| --- | --- | --- |
| Supabase 项目地址 | `Project Settings > API` 里的 Project URL | 形如 `https://xxxx.supabase.co` |
| 公开连接密钥 | 同一页的 anon 或 publishable key | 很长一串字符，只复制公开 key |
| 图片空间名称 | 默认 `echo-media` | 一般不用改 |

不要填写数据库密码或任何写着 Secret 的内容。它们不是给浏览器用的。

### 保存自己的账号绑定

1. 在应用 `设置 > 数据保存位置` 选择“Supabase 云同步”。
2. 填写昵称、用户名、密码；邮箱可选，但建议填写。
3. 填写 Supabase 项目地址和公开连接密钥。
4. 点击“登录/注册”。
5. 如需把当前账号和 GitHub 绑定，点击“GitHub 登录”完成授权后回到应用。
6. 点击“保存同步资料”。这会保存你的昵称、用户名和当前同步设置。
7. 换设备后，先填同一个 Supabase 项目的地址和公开连接密钥，登录同一账号，再点击“恢复同步资料”。

不要在任何前端设置里保存 `service_role`、数据库密码、对象存储 Secret、GitHub OAuth Client Secret。它们属于后台密钥。

## 5. 把当前浏览器里的 25 条记录放进私人云端

如果你现在打开页面能看到 25 条演出记录，它们通常只是保存在当前浏览器里，不在 GitHub 仓库里。要把它们放进你的私人 Supabase：

1. 先去 `备份` 页导出一次 JSON，留一份保险。
2. 去 `设置 > 数据保存位置`，选择“Supabase 云同步”。
3. 填写 Supabase 项目地址和公开连接密钥。
4. 填写昵称、用户名、密码，邮箱建议填写。
5. 点击“登录/注册”。
6. 点击“上传到我的云端”。
7. 打开 Supabase 的 `Table Editor > echo_records`，确认能看到记录。
8. 打开 `Storage > echo-media`，确认图片已经进入以你账号为开头的文件夹。

上传完成后，另一台设备只需要打开同一个应用，填写同一个 Supabase 项目地址和公开连接密钥，登录同一账号，再点“从云端恢复到本机”。

## 6. 可选：GitHub 登录

GitHub 登录仍然是 Supabase Auth 的一种登录方式。它不会把演出记录保存到 GitHub，也不会让不同 GitHub 用户看到彼此的数据。

1. 在 Supabase `Authentication > Sign In / Providers > GitHub` 复制 Callback URL，格式通常是 `https://<project-ref>.supabase.co/auth/v1/callback`。
2. 在 GitHub `Settings > Developer settings > OAuth Apps` 注册一个 OAuth App。
3. `Homepage URL` 填回响册站点，例如 `https://qi-i.github.io/live-memory/`。
4. `Authorization callback URL` 填 Supabase 提供的 Callback URL。
5. 把 GitHub OAuth App 的 Client ID 和 Client Secret 填回 Supabase 的 GitHub Provider 并保存。
6. 在 Supabase `Authentication > URL Configuration` 中，将回响册站点地址加入允许跳转地址；本地调试可额外加入 `http://127.0.0.1:5173/`。

配置完成后，应用设置页的“GitHub 登录”按钮会跳转到 GitHub 授权，再回到当前回响册站点。

## 7. 第一次同步

1. 先在“备份”页导出 JSON。
2. 在“设置”页填写 Supabase 项目地址和公开连接密钥。
3. 用邮箱密码或 GitHub 登录。
4. 登录成功后点击“上传到我的云端”。
5. 打开 Supabase Table Editor 和 Storage，确认记录与图片已出现。
6. 在另一台设备打开应用，用同一账号登录，点击“从云端恢复到本机”。

## 保存状态检查

设置页会显示本地记录、媒体数量、本地未上传图片、云端图片和最近同步时间。首次上传后，“本地未上传图片”应下降；外部海报链接不会被自动复制到图片空间。

## 常见问题

### `new row violates row-level security policy`

通常是未登录、登录会话过期，或 SQL 没有完整执行。确认 `auth.users` 中有当前用户，并重新登录。

### `Bucket not found`

统一检查三个位置都为 `echo-media`：SQL 创建的 bucket、`.env.local`、应用设置页。

### 第二个账号无法导入相同示例 ID

当前 migration 使用 `(user_id, id)` 复合主键，不同用户可以拥有相同本地记录 ID。若你执行过更早的单列主键 SQL，请新建项目或手工迁移主键后再同步。

### 图片链接过一段时间失效

私有图片使用短期访问链接。重新“从云端恢复到本机”会生成新地址；正式的后台同步版本应在图片加载失败时自动续签。

### 免费空间不够

应用上传前会将长边限制到 1800px。仍然不足时，优先只同步精选照片，把原图留在相册或硬盘；进一步方案见 [存储与发布策略](./storage-and-publishing.md)。
