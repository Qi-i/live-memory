# 回响册 Live Memory

把演出海报、电子票根、座位图、现场照片和观演记忆整理成一册私人档案。

[![Deploy GitHub Pages](https://github.com/Qi-i/live-memory/actions/workflows/deploy.yml/badge.svg)](https://github.com/Qi-i/live-memory/actions/workflows/deploy.yml)
[![Live site](https://img.shields.io/badge/GitHub%20Pages-打开回响册-dfff4f?logo=github&labelColor=101418)](https://qi-i.github.io/live-memory/)
[![License: MIT](https://img.shields.io/badge/License-MIT-f36b8a.svg)](./LICENSE)

## 使用入口

公开站点：**<https://qi-i.github.io/live-memory/>**

应用入口只允许两种明确状态：

1. **账号模式**：恢复真实头像、昵称、文字备份与个人 Supabase 配置，进入正式档案；
2. **访客临时模式**：不读取正式档案，不连接账号或个人 Supabase，新增数据仅存在于当前标签页，关闭后清空。

未登录状态不会继续展示以前保存在浏览器中的私人记录，也不会伪装成已登录账号。

## 核心功能

### 档案视图

同一套数据可切换十种统一设计的阅读方式：

- 海报：高密度等高卡片；
- 画报：适合视觉浏览的杂志式拼贴；
- 票夹：强调票座、场馆和临近日期；
- 纪念票根：票券式档案；
- 时间线：按年份和日期组织；
- 日历：按月份浏览；
- 城市/场馆：本地统计式足迹图与排名；
- 列表：适合快速检索和校对；
- 票价：票价排序、均价和累计支出；
- 汇总：艺人、城市、类型和标签统计。

档案控制栏集中处理搜索、类型、状态、年份、城市、艺人、排序和海报密度，不再重复全局导航。

### 分享画布

档案页可进入独立分享模式，生成横版、竖版或方形海报墙。分享画布隐藏应用导航和编辑控件，适合截图、打印或社交平台传播。

### 账号与存储

| 模块 | 保存内容 | 作用 |
| --- | --- | --- |
| 当前设备 | IndexedDB 中的完整档案 | 离线编辑和快速访问 |
| Live Memory 账号 | 登录身份、昵称、头像、偏好、文字备份和个人云端配置 | 跨设备恢复身份和基础资料 |
| 个人 Supabase | 演出文字、媒体索引和可选图片 | 完整跨设备同步 |
| 访客会话 | 当前标签页内存中的临时记录 | 安全预览，不触碰正式档案 |

个人 Supabase 使用用户自己的项目。浏览器端只能填写 `anon` 或 `publishable` key，不能使用数据库密码或 `service_role`。

### 主题与响应式界面

- 跟随系统、浅色、深色三种明暗模式；
- Aurora 与 Editorial 两套视觉主题；
- 统一的页面边界、间距、圆角、表面层级和控件尺寸；
- 桌面端为紧凑侧栏与单一上下文顶栏；
- 中等宽度自动折叠侧栏；
- 手机端使用底部主导航、横向视图切换和双列海报；
- 支持打印样式、减少动画偏好和键盘焦点提示。

## 数据与同步

账号登录后，应用先恢复账号资料和文字备份，再连接已保存的个人 Supabase。后续编辑采用自动同步，并在本地和云端同时修改时显示冲突选择，不静默覆盖。

云端图片使用短期 Signed URL。应用会在以下时机自动刷新：

- 登录并加载正式档案；
- 页面重新回到前台；
- 网络恢复；
- 图片加载失败；
- 定时续签；
- 设置页手动点击“刷新图片链接”。

设置页提供：

- 个人 Supabase 连接、重新连接；
- 上传当前档案、从云端恢复；
- 图片同步开关和 Signed URL 手动刷新；
- 完整 JSON、文字 JSON、CSV 导出；
- JSON 导入；
- 回收站恢复和永久删除确认；
- 当前设备与云端数据健康检查。

## 本地开发

需要 Node.js 20.19 以上，推荐 Node.js 22。

```powershell
git clone https://github.com/Qi-i/live-memory.git
cd live-memory
npm install
npm run dev
```

默认开发地址：<http://127.0.0.1:5173/>。

仅允许本机访问：

```powershell
npm run dev:local
```

完整验证：

```powershell
npm run check
```

该命令依次执行核心测试、TypeScript 类型检查和生产构建。拉取请求还会执行生产依赖安全审计与桌面端、移动端、分享画布自动截图检查。

## 配置账号服务

普通用户直接使用公开站点，不需要配置环境变量。自行部署时，复制 `.env.example` 为 `.env.local`：

```dotenv
VITE_ACCOUNT_SUPABASE_URL=https://YOUR_ACCOUNT_PROJECT.supabase.co
VITE_ACCOUNT_SUPABASE_ANON_KEY=YOUR_ACCOUNT_PUBLISHABLE_KEY

VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SUPABASE_MEDIA_BUCKET=echo-media
```

| 变量 | 用途 |
| --- | --- |
| `VITE_ACCOUNT_SUPABASE_URL` | Live Memory 账号、资料、偏好和文字备份 |
| `VITE_ACCOUNT_SUPABASE_ANON_KEY` | 账号项目公开连接密钥 |
| `VITE_SUPABASE_URL` | 可选的默认个人数据项目 |
| `VITE_SUPABASE_ANON_KEY` | 默认个人项目公开连接密钥 |
| `VITE_SUPABASE_MEDIA_BUCKET` | 图片空间名称，默认 `echo-media` |

## 初始化个人 Supabase

普通用户只需在个人项目的 `SQL Editor` 运行：

- [`005_passkey_cloud_sync.sql`](./supabase/migrations/005_passkey_cloud_sync.sql)

该 migration 会建立私人演出记录表、媒体索引、私有图片空间和访问规则。站点维护者部署账号项目时，按顺序运行账号相关 migrations。完整步骤见 [Supabase 配置指南](./docs/supabase-setup.md)。

## 发布到 GitHub Pages

仓库包含 [部署工作流](./.github/workflows/deploy.yml)：

1. 在仓库 `Settings > Pages` 中将 Source 设为 `GitHub Actions`；
2. 在 `Settings > Secrets and variables > Actions > Variables` 添加账号 Supabase 的 URL 和公开 key；
3. 推送到 `main`；
4. 等待 `Deploy GitHub Pages` 完成。

Vite 使用相对资源路径，可同时适配本地预览和 GitHub Pages 子路径。

## 数据边界

- 源码、文档、图标和演示素材进入 GitHub 仓库；
- 正式演出记录写入当前浏览器 IndexedDB，并按设置同步到账号文字备份或个人 Supabase；
- 访客数据只存在于当前标签页会话内存；
- 账号资料和个人 Supabase 公开连接配置写入账号项目；
- 完整同步写入个人项目的 `echo_passkey_records` 与 `echo_passkey_media_assets`；
- 图片仅在开启图片同步后进入私有 `echo-media` 空间；
- 完整 JSON 可能包含票根、二维码、订单信息和现场照片，应保存在私人设备或可信存储中。

## v3 项目结构

```text
src/
  App.tsx                 极简入口，转交 AppRoot
  AppRoot.tsx             页面组合、全局弹层和路由状态
  appController.ts        数据加载、自动同步、媒体续签和 CRUD 控制器
  access.tsx              登录、注册、GitHub OAuth 与访客入口
  experience.tsx          应用壳层、主题系统、桌面/移动导航和 GitHub 入口
  archive.tsx             档案筛选、十种视图与分享画布
  statsPage.tsx           个人统计与管理员统计
  settingsPage.tsx        账号、个人云端、显示、地图、导入导出和回收站
  overlays.tsx            详情、编辑器、导入、图片查看和确认弹窗
  syncConflictDialog.tsx  无损冲突处理
  domain.ts               数据模型、校验规则和默认设置
  storage.ts              IndexedDB、访客内存隔离和旧数据迁移
  supabase.ts             账号、文字备份、个人云端与媒体接口
  syncModel.ts            文字备份裁剪和本地媒体合并
  media.ts                图片压缩、头像和下载
  base.css                最小全局设计基础
  experience.css          壳层、主题和响应式导航
  archive.css             档案视图与分享画布
  settingsPage.css        设置模块
  statsPage.css           统计与管理页面
  overlays.css            抽屉、编辑器和弹窗
public/                    PWA 图标、manifest、Service Worker
supabase/migrations/       数据表、图片空间和访问规则
docs/                      使用、架构、同步和部署文档
scripts/                   自动测试与视觉审查
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
