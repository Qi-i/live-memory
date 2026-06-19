# 参与开发

感谢你愿意改进回响册。

## 开发流程

1. Fork 仓库并从 `main` 创建功能分支。
2. 使用 Node.js 22 和 `npm install` 安装依赖。
3. 保持修改聚焦，不提交 `.env.local`、个人备份、票根或现场照片。
4. 提交前运行 `npm run test` 和 `npm run check`。
5. 在 Pull Request 中说明用户可见变化、验证方式和相关截图。

## 代码约定

- TypeScript 保持 strict，不用 `any` 绕过领域模型。
- 数据进入存储前经过规范化；新字段要兼容旧备份缺失值。
- 账号、同步和删除行为需要加入 `scripts/run-tests.mjs` 核心断言。
- 图标优先使用 Lucide React。
- 组件在桌面和手机尺寸都要检查，文字不得溢出或遮挡。
- 图片展示尊重真实宽高，避免无理由强裁切主海报和座位图。
- 不在前端加入任何服务端 secret。

## 数据库变更

新增不可逆 schema 变化时，请创建新的顺序 migration，不要修改已经发布并被用户执行的 migration。Pull Request 需要说明回滚方式和 RLS 影响。

## Issue

Bug 报告请包含复现步骤、预期结果、实际结果、浏览器/设备和不含个人信息的截图。安全漏洞不要提交公开 Issue，请阅读 `SECURITY.md`。
