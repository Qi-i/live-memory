# 回响册 - Live Memory

本地优先、可同步的个人演出档案。它把票根、电子海报、座位图和现场精选照片放在第一位，同时支持演唱会、音乐节、Livehouse、拼盘演出和多艺人阵容。

## 当前架构

- `Vite + React + TypeScript`
- IndexedDB 本地保存，首次打开会迁移旧版 `echo-archive-local/events` 数据
- Supabase Auth + Database + Storage 私人同步
- GitHub Pages 只发布应用代码，不存个人图片
- 大麦公开链接导入会生成可编辑草稿，个人票价、座位、同行人和现场照片由你补充

## 本地运行

```powershell
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173/
```

手机同一局域网访问时，使用电脑的局域网 IP：

```text
http://电脑IP:5173/
```

## 发布到 GitHub Pages

1. 将项目推送到 GitHub。
2. 仓库 Settings / Pages 选择 GitHub Actions。
3. 推送到 `main` 后，`.github/workflows/deploy.yml` 会自动构建并发布 `dist`。

注意：不要把个人票根、现场照片、大量截图直接提交到 GitHub。GitHub Pages 是静态站点托管，发布站点和仓库都有体积限制；个人图片应该保存在 Supabase Storage 或本地备份里。

## Supabase 设置

1. 新建 Supabase 项目。
2. 在 SQL Editor 执行 `supabase/migrations/001_echo_archive.sql`。
3. 在 Project Settings / API 复制 Project URL 和 anon public key。
4. 回到应用的“设置”，填入 URL、anon key、邮箱和密码。
5. 点击“登录/注册”，再点击“推送到云端”或“从云端拉取”。

同步设计：

- `echo_records` 保存演出元数据和媒体引用。
- `echo_media_assets` 保存媒体索引。
- `echo-media` 私有 bucket 保存本地上传图片。
- RLS 策略限制为 `auth.uid()` 自己的数据。
- 浏览器只使用 anon public key，不需要也不应该暴露 service role key。

## 数据和备份

应用默认离线可用。所有记录先存在当前浏览器 IndexedDB 中；你可以在“备份”页导出完整 JSON，迁移到其他设备或做长期备份。

如果配置 Supabase，同步会把本地 data URL 图片上传到私有 Storage，并把记录中的图片引用替换成私有签名地址。旧版数据会在首次启动新版时自动迁移。

## 功能清单

- 档案、时间线、统计、备份、设置
- 瀑布流、海报、票夹、纪念票根、时间线、票价、汇总、日历、场馆/城市、列表视图
- 多选类型、状态、年份、城市、艺人筛选
- 海报/文字点击进入详情
- 详情页查看大海报、座位图、现场照片墙、票价座位、来源链接、曲目和备注
- 图片点击放大、下载、复制地址
- 批量粘贴链接/文本导入，批量图片导入
- JSON/CSV 导出，JSON 恢复
- Supabase 私人同步和存储健康检查
- 高德/百度地图 Key 预留；未配置时显示稳定的城市/场馆足迹

## 构建检查

```powershell
npm run build
```
