# 回响册 Live Memory

把演出海报、电子票根、座位图、现场照片和观演记忆整理成一册私人档案。

[![Deploy GitHub Pages](https://github.com/Qi-i/live-memory/actions/workflows/deploy.yml/badge.svg)](https://github.com/Qi-i/live-memory/actions/workflows/deploy.yml)
[![Live site](https://img.shields.io/badge/GitHub%20Pages-打开回响册-dfff4f?logo=github&labelColor=101418)](https://qi-i.github.io/live-memory/)
[![License: MIT](https://img.shields.io/badge/License-MIT-f36b8a.svg)](./LICENSE)

![回响册桌面端档案视图](./docs/images/archive-desktop.png)

## 直接使用

打开公开地址即可使用，无需下载：

**<https://qi-i.github.io/live-memory/>**

首次进入时创建 Live Memory 账号，并选择一种保存方式：

| 保存方式 | 演出文字 | 图片 | 适用场景 |
| --- | --- | --- | --- |
| 账号文字备份 | 随账号同步 | 留在当前设备 | 图片较多、希望节省云端空间 |
| Supabase 完整同步 | 同步 | 可选择同步 | 电脑和手机查看同一套完整档案 |

公开站点内置 3 条演示记录。每位用户的档案保存在自己的浏览器和账号空间中，不会写入 GitHub 仓库。

## 功能

- 海报、票夹、纪念票根、时间线、票价、汇总、日历、场馆/城市和列表视图。
- 演唱会、音乐节、Livehouse、剧场等类型，支持多艺人和完整阵容。
- 海报、票根、座位图、现场精选照片分类管理与大图查看。
- 类型、状态、年份、城市、艺人、标签多选筛选和多种排序。
- 大麦公开链接、文本、多张图片、JSON 备份批量导入。
- Live Memory 账号资料、文字云备份和自动备份。
- 用户自带 Supabase 完整同步，图片上传可独立关闭。
- 删除二次确认、回收站恢复和永久删除确认。
- JSON 完整备份、JSON 文字备份和 CSV 导出。
- 响应式桌面/手机界面与 PWA 安装。

![回响册移动端档案视图](./docs/images/archive-mobile.png)

## 本地运行

本地运行适合开发、修改界面或部署自己的版本。需要 Node.js 20.19 以上，推荐 Node.js 22。

```powershell
git clone https://github.com/Qi-i/live-memory.git
cd live-memory
npm install
npm run dev
```

电脑打开 <http://127.0.0.1:5173/>。手机与电脑连接同一 Wi-Fi 后，打开终端显示的 `Network` 地址。

仅允许本机访问：

```powershell
npm run dev:local
```

构建并预览发布版本：

```powershell
npm run check
npm run preview
```

预览地址为 <http://127.0.0.1:5174/>。

## 配置账号服务

维护公开站点时，需要为 Live Memory 账号和文字备份配置一个 Supabase 项目。复制 `.env.example` 为 `.env.local`：

```dotenv
VITE_ACCOUNT_SUPABASE_URL=https://YOUR_ACCOUNT_PROJECT.supabase.co
VITE_ACCOUNT_SUPABASE_ANON_KEY=YOUR_ACCOUNT_PUBLISHABLE_KEY

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SUPABASE_MEDIA_BUCKET=echo-media
```

| 变量 | 用途 |
| --- | --- |
| `VITE_ACCOUNT_SUPABASE_URL` | Live Memory 账号、资料、密码找回和文字备份 |
| `VITE_ACCOUNT_SUPABASE_ANON_KEY` | 账号项目的公开连接密钥 |
| `VITE_SUPABASE_URL` | 可选的默认个人数据项目；通常由用户在设置页填写 |
| `VITE_SUPABASE_ANON_KEY` | 默认个人数据项目的公开连接密钥 |
| `VITE_SUPABASE_MEDIA_BUCKET` | 图片空间名称，默认 `echo-media` |

浏览器变量只能使用 `anon` 或 `publishable` key。数据库密码、`service_role` 和其他 Secret 不得写入 `.env`、前端代码或 GitHub Variables。

## 初始化 Supabase

在 Supabase `SQL Editor` 中按顺序运行：

1. [`001_echo_archive.sql`](./supabase/migrations/001_echo_archive.sql)
2. [`002_account_profiles.sql`](./supabase/migrations/002_account_profiles.sql)
3. [`003_account_identity_fields.sql`](./supabase/migrations/003_account_identity_fields.sql)
4. [`004_account_backup_and_validation.sql`](./supabase/migrations/004_account_backup_and_validation.sql)

四个文件会建立演出记录、媒体索引、账号资料、文字备份、私有图片空间和用户访问规则。完整操作见 [Supabase 配置指南](./docs/supabase-setup.md)。

## 把现有记录迁入私人云端

1. 在应用 `备份` 页导出一次完整 JSON。
2. 在 `设置 > 数据保存位置` 选择 `Supabase 完整同步`。
3. 填写项目地址和公开连接密钥。
4. 输入 Live Memory 用户名和密码，点击 `连接个人云端`。
5. 决定是否开启 `同步图片`。
6. 点击 `上传到我的云端`。
7. 在 Supabase `Table Editor > echo_records` 检查记录数量；开启图片同步时，再到 `Storage > echo-media` 检查图片。

## 发布到 GitHub Pages

仓库包含 [部署工作流](./.github/workflows/deploy.yml)。

1. 打开 GitHub 仓库 `Settings > Pages`。
2. 将 `Build and deployment > Source` 设为 `GitHub Actions`。
3. 在 `Settings > Secrets and variables > Actions > Variables` 添加 `VITE_ACCOUNT_SUPABASE_URL` 和 `VITE_ACCOUNT_SUPABASE_ANON_KEY`。
4. 推送到 `main`，等待 `Deploy GitHub Pages` 完成。

更多发布、缓存和 404 排查见 [部署指南](./docs/deployment.md)。

## 数据边界

- 源代码、图标、文档和 3 条演示记录进入 GitHub。
- 演出记录先写入浏览器 IndexedDB。
- 文字备份写入账号项目的 `echo_text_backups`。
- 完整同步写入用户个人项目的 `echo_records` 和 `echo_media_assets`。
- 图片仅在开启图片同步后进入私有 `echo-media` 空间。
- 回收站使用 `deletedAt` 和云端 `deleted_at` 保留可恢复删除状态。
- 每张云端表都按当前用户 ID 限制访问。

完整 JSON 可能包含票根、二维码、订单信息和现场照片，请保存在私人设备或可信存储中。

## 项目结构

```text
src/
  domain.ts             数据模型、输入规则与默认设置
  storage.ts            IndexedDB、降级存储和旧数据迁移
  supabase.ts           账号、文字备份、完整同步和图片上传
  syncModel.ts          文字备份裁剪与本地图片合并规则
  media.ts              图片压缩、头像处理和下载
  importers.ts          公开链接与文本导入
  storageProviders.ts   对象存储适配接口
  App.tsx               页面、视图、详情、回收站和设置流程
  styles.css            设计系统与响应式布局
public/                  PWA 图标、manifest、Service Worker
supabase/migrations/     数据表、图片空间和访问规则
docs/                    使用、架构、同步和部署文档
```

## 文档

- [Supabase 配置指南](./docs/supabase-setup.md)
- [数据与同步](./docs/data-and-sync.md)
- [实现架构](./docs/architecture.md)
- [存储与发布策略](./docs/storage-and-publishing.md)
- [部署指南](./docs/deployment.md)
- [安全策略](./SECURITY.md)
- [参与开发](./CONTRIBUTING.md)
- [更新记录](./CHANGELOG.md)

## 技术栈

Vite 7、React 18、TypeScript 5、IndexedDB、Supabase、Lucide React、Service Worker、GitHub Actions 和 GitHub Pages。

本项目采用 [MIT License](./LICENSE)。
