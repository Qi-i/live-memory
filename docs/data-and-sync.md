# 数据与同步

## 本地数据

记录默认写入 IndexedDB 数据库 `echo-archive-v2` 的 `records` store。设置保存在 localStorage。若 IndexedDB 不可用，记录会降级写入 localStorage，但浏览器对 localStorage 的容量更小，不适合大量图片。

图片导入后在浏览器压缩：默认最长边 1800px，JPEG 质量 0.88；PNG 保持 PNG。压缩结果在上传前以 data URL 随媒体资产保存在本地记录中。

## 云端数据

回响册的公开站点只是共享应用入口，不是共享数据空间。登录后，所有云端读写都绑定到当前 Supabase Auth 用户。

如果要做“打开公开网站，输入回响册账号密码，然后自动读取自己的绑定配置”，公开站点需要预先连接一个中心 Supabase 项目。这个项目提供 Supabase Auth 登录和 `echo_user_profiles` 私有绑定表；真正的演出记录既可以继续放在同一个 Supabase 项目并由 RLS 隔离，也可以在读取绑定后切换到用户自己的 Supabase 项目。

| 数据 | 位置 | 可见性 |
| --- | --- | --- |
| 演出字段和媒体引用 | `echo_records.payload` | 当前登录用户 |
| 图片索引 | `echo_media_assets` | 当前登录用户 |
| 账号绑定资料 | `echo_user_profiles` | 当前登录用户 |
| 图片文件 | `echo-media/userId/recordId/mediaId.ext` | 私有、RLS 控制 |
| Supabase 会话 | 浏览器本地 Auth storage | 当前浏览器 |

记录和媒体表使用 `(user_id, id)` 复合主键，避免不同用户导入相同示例记录时互相冲突。

## 账号隔离模型

- 每条演出记录都保存 `user_id`。
- 每个网站账号对应 Supabase Auth 中的一个用户。邮箱密码由 Supabase Auth 管理，应用表不保存密码。
- `echo_user_profiles` 只保存当前用户自己的显示名、GitHub 标识和客户端绑定配置。
- `echo_records` 与 `echo_media_assets` 的 RLS 只允许 `auth.uid() = user_id` 的用户读写。
- Storage bucket 是私有的，文件路径第一段必须是当前用户 ID。
- GitHub OAuth 只是 Supabase Auth 的登录方式；GitHub 不保存演出数据。
- 如果多人共用同一个 Supabase 项目，普通用户之间仍然互相不可见；项目拥有者在 Supabase 后台拥有管理权限。

## 推送

1. 获取当前认证用户。
2. 找出 `data:` 开头且没有 `storagePath` 的媒体。
3. 上传到当前用户目录并生成签名 URL。
4. upsert `echo_records`。
5. upsert `echo_media_assets`。

一次推送中途失败时，已成功上传的对象可能保留；再次推送使用同一路径和 `upsert`，可继续完成。

## 拉取

1. 查询当前用户未软删除的记录。
2. 规范化 payload，兼容缺失字段。
3. 为带 `storagePath` 的私有图片生成七天签名 URL。
4. 用云端集合替换当前本地集合。

因此，拉取前应先确认本地新增内容已推送或已导出备份。当前版本不会自动合并两端同时修改的字段。

## 备份

JSON 是恢复能力最完整的格式，可能包含本地 data URL 图片，文件较大且具有隐私敏感性。CSV 只包含表格化元数据，不包含图片本体。

建议：

- 大改或首次同步前导出 JSON。
- 每月保留一份离线备份。
- 不把个人备份提交到 GitHub、公开网盘或 Issue。
- 恢复后抽查图片、中文、日期和多艺人阵容。

## 冲突与删除

schema 已保留 `updated_at`、`deleted_at`，但 UI 目前使用完整集合推送/拉取。后续增量同步应引入：

- 每条记录的单调版本或 `updated_at + device_id`。
- 本地待同步队列和可重试任务。
- 删除墓碑同步与定期清理。
- 同一记录双端修改时的字段级比较。
- 媒体上传完成确认和孤儿对象清理。
