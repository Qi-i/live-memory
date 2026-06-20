# Supabase 配置指南

Supabase 在回响册里有两种用途：

| 角色 | 需要做什么 | 保存什么 |
| --- | --- | --- |
| 普通用户 | 建立自己的个人档案项目 | 演出记录、票根、座位图和照片 |
| 站点维护者 | 建立 Live Memory 账号项目 | 登录、找回密码、账号资料和文字备份 |

只使用公开站点时，先看“普通用户”一节。只有 Fork 仓库并发布自己的站点时，才需要配置“站点维护者”一节。

## 普通用户：建立个人档案项目

### 1. 创建项目

1. 打开 [Supabase Projects](https://supabase.com/dashboard/projects)。
2. 登录后点击 `New project`。
3. 项目名填写 `live-memory` 或自定义名称。
4. 设置数据库密码并妥善保存。该密码只用于 Supabase 后台，不填入 Live Memory。
5. 等待项目创建完成。

### 2. 建立数据表和图片空间

在项目左侧打开 `SQL Editor`，点击 `New query`。按顺序打开仓库中的五个文件，复制完整内容并逐个运行：

```text
supabase/migrations/001_echo_archive.sql
supabase/migrations/002_account_profiles.sql
supabase/migrations/003_account_identity_fields.sql
supabase/migrations/004_account_backup_and_validation.sql
supabase/migrations/005_passkey_cloud_sync.sql
```

完成后检查：

- `Table Editor` 中有 `echo_passkey_records`、`echo_passkey_media_assets`、`echo_text_backups`。
- `Storage` 中有 `echo-media`，并且不是 Public。
- 每张表的 RLS 状态为 Enabled。

### 3. 获取连接信息

打开 `Project Settings > API`，找到：

- `Project URL`：填入应用的“Supabase 项目地址”。
- `anon key` 或 `publishable key`：填入“公开连接密钥”。

不要填写数据库密码、`service_role`、Secret key 或 GitHub Client Secret。

### 4. 连接个人云端

个人档案项目不需要设置邮件登录。回响册会根据“用户名 + 个人云端密码 + Supabase 项目地址”生成同步钥匙，用它读取和写入自己的记录。

回到 Live Memory：

1. 打开 `设置 > 数据保存位置`。
2. 选择 `Supabase 完整同步`。
3. 粘贴项目地址和公开连接密钥。
4. 选择是否开启“同步图片”。
5. 输入 Live Memory 用户名和个人云端密码，点击“连接个人云端”。

个人云端密码不是 Supabase 后台数据库密码，也不是 Live Memory 找回邮箱。换设备时输入同一用户名、同一密码和同一个 Supabase 项目，就能恢复同一份档案。

### 5. 上传现有档案

如果 25 条记录仍显示在本地开发地址，而公开站点只有 3 条示例，先在原页面导出完整 JSON，再到公开站点导入。两个网址使用不同的浏览器存储，数据不会自动搬过去。

1. 在能看到 25 条记录的页面打开 `备份`，导出完整 JSON。
2. 在准备长期使用的站点导入这份 JSON，并确认记录数量。
3. 回到设置页点击“上传到我的云端”。
4. 在 `Table Editor > echo_passkey_records` 检查有 25 条记录。
5. 开启图片同步时，在 `Storage > echo-media` 检查以同步钥匙开头的目录。

GitHub 仓库只包含 3 条演示记录。导入的 25 条记录先进入当前浏览器，上传后进入你自己的 Supabase，其他账号无法读取。

另一台设备恢复时，填写同一个项目地址和公开连接密钥，使用相同用户名和个人云端密码连接，再点击“从云端恢复到本机”。

## 站点维护者：建立账号项目

账号项目承载 Live Memory 登录、账号资料、密码找回和文字备份。普通用户不需要自己配置这一节。

1. 创建独立 Supabase 项目。
2. 运行五个 migration。
3. 在 `Authentication > Providers > Email` 开启邮箱登录；如允许用户不填写找回邮箱，请关闭邮件确认。
4. 在 `Authentication > URL Configuration` 设置站点 URL，并加入生产与本地跳转地址。
5. 在密码找回邮件模板中将产品名改为 `Live Memory`。
6. 在项目的 Auth 设置中将最短密码长度设为 8。
7. 将 Project URL 和 publishable key 写入部署环境的 `VITE_ACCOUNT_SUPABASE_URL`、`VITE_ACCOUNT_SUPABASE_ANON_KEY`。

### GitHub Pages Variables

在 GitHub 仓库打开：

`Settings > Secrets and variables > Actions > Variables > New repository variable`

添加：

```text
VITE_ACCOUNT_SUPABASE_URL
VITE_ACCOUNT_SUPABASE_ANON_KEY
```

推送一次 `main` 后，部署工作流会把这两项交给 Vite 构建。它们是浏览器公开连接信息，安全边界由数据库访问规则提供。

### GitHub 登录

1. 在账号项目 `Authentication > Sign In / Providers > GitHub` 复制 Callback URL。
2. 在 GitHub `Settings > Developer settings > OAuth Apps` 新建 OAuth App。
3. Homepage URL 填 Live Memory 站点地址。
4. Authorization callback URL 填 Supabase 提供的 Callback URL。
5. 把 GitHub Client ID 和 Client Secret 填回 Supabase GitHub Provider。
6. Client Secret 只留在 Supabase 后台。

## 找回邮箱与个人 Supabase

两者用途不同：

- 找回邮箱：接收 Live Memory 密码找回邮件。
- 个人 Supabase：保存演出记录与图片，使用同步钥匙识别自己的档案。

修改个人 Supabase 项目不会改变 Live Memory 找回邮箱。更换找回邮箱也不会自动修改个人档案项目。

## 常见问题

### 提示数据表不存在

重新按顺序运行五个 migration，确认每个查询都显示 Success。

### `new row violates row-level security policy`

重新点击“连接个人云端”，再执行上传。仍然失败时检查 migration 是否完整运行。

### `Auth session missing`

更新到最新页面后，先运行 `005_passkey_cloud_sync.sql`，再重新点击“连接个人云端”。如果是在“账号文字备份”中看到这个提示，请先登录 Live Memory 账号。

### `email rate limit exceeded`

个人档案项目只需要数据表和图片空间。运行 `005_passkey_cloud_sync.sql` 并使用最新版页面后，再重新连接个人云端。

### `Bucket not found`

检查 `Storage` 中是否有 `echo-media`，并确认应用“更多同步设置”中的图片空间名称一致。

### 图片空间增长太快

关闭“同步图片”即可只同步文字。完整图片继续保存在当前设备，并通过完整 JSON 定期备份。也可以只上传海报、票根、座位图和少量现场精选。

### 找回密码收不到邮件

找回邮件由账号项目发送，与个人 Supabase 项目无关。检查注册时填写的找回邮箱、垃圾邮件目录和账号项目的 Auth 邮件日志。
