<p align="center">
  <img src="./public/brand-lockup.svg" width="560" alt="现场记 Live Memory" />
</p>

<p align="center"><strong>把演出海报、票根、座位图和现场照片，整理成一份会持续生长的个人现场档案。</strong></p>

<p align="center">
  <a href="https://github.com/Qi-i/live-memory/actions/workflows/deploy.yml"><img src="https://github.com/Qi-i/live-memory/actions/workflows/deploy.yml/badge.svg" alt="Deploy GitHub Pages" /></a>
  <a href="https://qi-i.github.io/live-memory/"><img src="https://img.shields.io/badge/GitHub%20Pages-打开现场记-159b88?logo=github&labelColor=10201b" alt="Live site" /></a>
  <img src="https://img.shields.io/badge/Version-2.3.0-0b8f78.svg" alt="Version 2.3.0" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-315ed8.svg" alt="License: MIT" /></a>
</p>

## 在线使用

**<https://qi-i.github.io/live-memory/>**

进入应用后可选择：

- **账号模式**：恢复头像、昵称、文字备份和个人 Supabase 配置；
- **访客示例**：使用内置公开演出数据体验全部视图，修改仅保存在当前标签页。

未登录时不会读取浏览器中可能存在的私人档案。

## 2.3.0 更新

本版本重构首页档案 Banner、分享工作室和档案多视图，重点提升海报完整性、成图密度、移动端可读性及线上发布可验证性。

- 首页改为编辑型视觉 Banner，保留 3 张完整悬浮的代表性海报，不再硬裁或突兀截断；
- 分享工作室默认使用竖版 4:5，普通比例自动完整适配成图区，并提供适应窗口和手动缩放；
- 密集海报墙、时间长卷和编目杂志按海报真实比例重新排版，减少无效留白并强化大小层级；
- 城市路线使用明确标注的非地图坐标场，不绘制国界或行政区边界；
- 优化票夹、票根和列表视图的桌面端与移动端信息密度；
- GitHub Pages 构建产物新增 `build-info.json`，部署后自动核验线上提交 SHA。

## 为什么做“现场记”

购票平台适合完成交易，却不适合长期保存个人观演记忆。现场记把每场演出的海报、票根、座位、城市、同行人和现场照片组织成可检索、可统计、可分享的私人档案。

新 Logo 由两条相互穿行的轨迹构成：既像舞台灯光与声波，也像一次次现场经历最终汇聚成个人记忆。中文名称“现场记”和英文名称“Live Memory”可同时用于应用、导出分享图及项目传播。

## 核心功能

### 多种档案视图

同一套数据可切换多种统一设计的阅读方式：

- 海报：桌面端高密度多列，移动端双列；
- 画报：强调视觉浏览的杂志式拼贴；
- 票夹与纪念票根：集中查看票面、座位和场馆；
- 时间线与日历：按日期组织观演经历；
- 城市/场馆：查看现场足迹；
- 列表、票价与汇总：用于检索、校对和统计。

视觉页面统一采用更接近常见演出海报的 **4:5 默认框架**。海报会放大填满画面，不再出现上下虚化边；完整原图仍保留在详情查看中。

### 高级现场分享图

分享制作不是简单截图，而是独立的排版工具：

- 按时间默认从新到旧；
- 可快速勾选演唱会、音乐节、Livehouse、剧场等类型；
- 支持全部记录、日期范围、年份快捷选择和逐场手动勾选；
- 支持 12、20、30 张或全部海报；
- 支持竖版 4:5、方形 1:1、横版 16:9 和手机长图；
- 提供四种真正不同的布局：密集海报墙、时间长卷、编目杂志、城市路线；
- 导出 PNG 时同步显示现场记 Logo、GitHub 项目地址和可选档案统计。

### 账号与存储

| 模块 | 保存内容 | 作用 |
| --- | --- | --- |
| 当前设备 | IndexedDB 中的完整档案 | 离线编辑和快速访问 |
| 现场记账号 | 登录身份、昵称、头像、偏好和文字备份 | 跨设备恢复基础资料 |
| 个人 Supabase | 演出文字、媒体索引和可选图片 | 完整跨设备同步 |
| 访客会话 | 当前标签页中的临时示例记录 | 安全体验，不读取正式档案 |

浏览器端只能填写 Supabase 的 `anon` 或 `publishable` key，不能使用数据库密码或 `service_role`。

### 主题与响应式界面

- 跟随系统、浅色、深色三种明暗模式；
- Aurora 与 Editorial 两套视觉主题；
- 桌面端使用紧凑侧栏和单一上下文顶栏；
- 中等宽度自动折叠侧栏；
- 手机端使用底部主导航、横向视图切换和双列海报；
- 分享制作在手机端使用上下分区编辑界面。

## 数据同步

账号登录后，应用先恢复账号资料和文字备份，再连接已保存的个人 Supabase。后续编辑采用自动同步；本地和云端同时发生修改时，会显示冲突选择，不静默覆盖。

图片下载后会写入浏览器 Cache Storage，档案视图、分享预览和 PNG 导出复用同一份缓存。Signed URL 仅在缺失、临近过期或单张图片加载失败时刷新。

设置页提供：

- 个人 Supabase 连接、重新连接；
- 上传当前档案、从云端恢复；
- 图片同步开关与链接刷新；
- JSON、文字 JSON、CSV 导入导出；
- 回收站恢复和永久删除；
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

完整验证：

```powershell
npm run check
```

该命令执行核心测试、TypeScript 类型检查和生产构建。拉取请求还会执行生产依赖安全审计，以及桌面端、移动端和分享画布自动截图检查。

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
| `VITE_ACCOUNT_SUPABASE_URL` | 现场记账号、资料、偏好和文字备份 |
| `VITE_ACCOUNT_SUPABASE_ANON_KEY` | 账号项目公开连接密钥 |
| `VITE_SUPABASE_URL` | 可选的默认个人数据项目 |
| `VITE_SUPABASE_ANON_KEY` | 默认个人项目公开连接密钥 |
| `VITE_SUPABASE_MEDIA_BUCKET` | 图片空间名称，默认 `echo-media` |

## 初始化个人 Supabase

普通用户只需在个人项目的 `SQL Editor` 运行：

- [`005_passkey_cloud_sync.sql`](./supabase/migrations/005_passkey_cloud_sync.sql)

该 migration 会建立私人演出记录表、媒体索引、私有图片空间和访问规则。完整步骤见 [Supabase 配置指南](./docs/supabase-setup.md)。

## 发布到 GitHub Pages

仓库包含 [部署工作流](./.github/workflows/deploy.yml)：

1. 在仓库 `Settings > Pages` 中将 Source 设为 `GitHub Actions`；
2. 在 `Settings > Secrets and variables > Actions > Variables` 添加账号 Supabase URL 和公开 key；
3. 推送到 `main`；
4. 等待 `Deploy GitHub Pages` 完成。

## 数据边界

- 源码、文档、Logo 和演示素材进入 GitHub 仓库；
- 正式演出记录写入当前浏览器 IndexedDB，并按设置同步；
- 访客数据只存在于当前标签页会话内存；
- 图片仅在开启图片同步后进入私有 `echo-media` 空间；
- 完整 JSON 可能包含票根、二维码、订单信息和现场照片，应保存在私人设备或可信存储中。

## 项目结构

```text
src/
  AppRoot.tsx             页面组合、全局弹层和路由状态
  appController.ts        数据加载、自动同步、媒体续签和 CRUD
  access.tsx              登录、注册、GitHub OAuth 与访客入口
  experience.tsx          应用壳层、主题系统和响应式导航
  archive.tsx             档案筛选与多种视图
  shareStudio.tsx         分享筛选、四种布局与 PNG 导出
  brand.tsx               现场记 Logo 和文字标识
  mediaCache.ts           图片缓存与跨视图复用
  settingsPage.tsx        账号、云端、显示、导入导出和回收站
  statsPage.tsx           个人统计与管理员页面
public/
  icon.svg                应用图标
  brand-lockup.svg        GitHub 与宣传用 Logo 组合
```

## 文档

- [Supabase 配置指南](./docs/supabase-setup.md)
- [数据与同步](./docs/data-and-sync.md)
- [实现架构](./docs/architecture.md)
- [部署指南](./docs/deployment.md)
- [安全策略](./SECURITY.md)
- [参与开发](./CONTRIBUTING.md)
- [更新记录](./CHANGELOG.md)

技术栈：Vite 7、React 18、TypeScript 5、IndexedDB、Supabase、Lucide React、Service Worker、GitHub Actions 和 GitHub Pages。

本项目采用 [MIT License](./LICENSE)。
