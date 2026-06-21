# 部署指南

## GitHub Pages

### 首次启用

1. 将仓库推送到 GitHub。
2. 打开 `Settings > Pages`。
3. 在 `Build and deployment` 中把 `Source` 设为 `GitHub Actions`。
4. 打开 `Actions > Deploy GitHub Pages`，运行最新工作流，或推送一次 `main`。

工作流分为两个 job：

- `Build application`：安装锁定依赖、运行类型检查、构建并上传 Pages artifact。
- `Deploy to GitHub Pages`：使用 GitHub OIDC 权限创建 Pages deployment。

### 环境变量

公开部署需要配置 Live Memory 账号项目，才能提供账号登录、找回密码、账号资料、显示偏好、个人云端配置和文字备份。在 `Settings > Secrets and variables > Actions > Variables` 添加：

```text
VITE_ACCOUNT_SUPABASE_URL
VITE_ACCOUNT_SUPABASE_ANON_KEY
```

部署工作流会把这两项映射到构建环境。用户个人 Supabase 由用户在应用设置页填写，不需要放入仓库变量。

为兼容旧部署，工作流在找不到账号专用变量时会读取 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。新部署应使用账号专用变量，避免把账号项目与用户个人档案项目混淆。

注意：所有 `VITE_*` 最终都会进入前端 bundle。这里只能放 Supabase URL 和 anon/publishable key，不能放 `service_role`、数据库密码、R2 Secret 或 COS Secret。

个人项目地址和公开连接密钥会先保存在用户自己的浏览器设置中；登录 Live Memory 账号后，也会写入该账号的私有资料，换设备登录后自动恢复。公开站点已登录账号时，连接个人云端不需要再次输入密码。

### 公开站点与私人数据

GitHub Pages 发布同一套静态应用。账号文字备份进入账号项目，完整档案进入用户自己的 Supabase 项目。

- 开源仓库和 Pages 站点可以共享。
- 个人记录、票根、座位图和现场照片不应进入仓库。
- 账号项目只保存账号资料、显示偏好、个人云端公开连接配置和不含图片的文字备份。
- 每个人可连接自己的 Supabase 项目保存完整档案，连接过程只使用当前账号生成的连接钥匙。

### 站点地址

项目站点默认地址：

```text
https://qi-i.github.io/live-memory/
```

`vite.config.ts` 使用 `base: "./"`，避免仓库子路径下静态资源 404。

## 发布前检查

```powershell
npm ci
npm run check
npm run preview
```

在桌面和手机宽度检查：档案首屏、筛选、详情、大图、批量添加、备份和设置。生产预览地址默认为 <http://127.0.0.1:5174/>。

## 常见失败

### Build 成功、Deploy 返回 404

Pages 尚未启用。回到 `Settings > Pages`，把 Source 设为 GitHub Actions；不要反复运行旧任务。

### `Resource not accessible by integration`

工作流 token 没有权限创建 Pages 站点。先在仓库设置中人工启用 Pages。当前 workflow 只配置已存在的 Pages 站点，不再尝试自动创建。

### 页面打开但资源 404

确认构建产物使用相对路径，并清理旧 Service Worker 缓存后刷新。当前 `vite.config.ts` 已为 GitHub 项目页设置相对 base。

### 新版本一直不出现

先普通刷新；仍有问题时在浏览器开发者工具的 Application 中注销旧 Service Worker 并清除站点缓存。当前导航请求采用 network-first，正常情况下会优先获取新版 HTML。

## 回滚

GitHub Pages 部署来自 `main`。需要回滚时，优先创建一个撤销问题提交的新 commit，再推送触发部署；不要重写公开分支历史。个人数据在 IndexedDB/Supabase，不应随前端代码回滚而删除。
