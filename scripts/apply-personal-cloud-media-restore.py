from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"expected block not found in {path}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

supabase = "src/supabase.ts"
old_sync = '''  // 4. Once the saved personal project is connected, immediately renew media URLs.\n  // This is intentionally after text recovery so restored local storage paths are signed too.\n  if (personalCloudStatus === "connected" && nextSettings.supabase.syncMedia) {\n    try {\n      nextRecords = await refreshSignedMediaUrls(nextSettings, nextRecords, { force: true });\n      messages.push("云端图片已恢复");\n    } catch {\n      personalCloudStatus = "reconnect-needed";\n      messages.push("云端图片待恢复");\n    }\n  }\n'''
new_sync = '''  // 4. Once the saved personal project is connected, restore the full personal-cloud\n  // record/media catalog before renewing signed URLs. Account text backup intentionally\n  // omits media, so a new device cannot recover posters by signing local references alone.\n  if (personalCloudStatus === "connected" && nextSettings.supabase.syncMedia) {\n    try {\n      const restored = await restorePersonalCloudMedia(nextSettings, nextRecords);\n      nextRecords = restored.records;\n      messages.push(restored.message);\n    } catch {\n      personalCloudStatus = "reconnect-needed";\n      messages.push("云端图片待恢复");\n    }\n  }\n'''
replace_once(supabase, old_sync, new_sync)

marker = '''export async function purgeRecordFromSupabase(settings: AppSettings, recordId: string) {\n'''
helper = '''export function mergePersonalCloudMedia(baseRecords: EventRecord[], personalRecords: EventRecord[]) {\n  const merged = new Map(baseRecords.map((record) => [record.id, record]));\n  for (const personal of personalRecords) {\n    const base = merged.get(personal.id);\n    if (!base) {\n      merged.set(personal.id, normalizeRecord(personal));\n      continue;\n    }\n    const textSource = personal.updatedAt > base.updatedAt ? personal : base;\n    const media = personal.media.length ? personal.media : base.media;\n    merged.set(personal.id, normalizeRecord({\n      ...textSource,\n      media,\n      syncedAt: personal.syncedAt || base.syncedAt,\n    }));\n  }\n  return Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date));\n}\n\nexport async function restorePersonalCloudMedia(settings: AppSettings, baseRecords: EventRecord[]): Promise<SyncResult> {\n  if (!settings.supabase.ownerKey) throw new Error("请先连接个人云端");\n  const personal = await pullRecordsFromPasskeySupabase(settings, []);\n  const merged = mergePersonalCloudMedia(baseRecords, personal.records);\n  const records = settings.supabase.syncMedia\n    ? await refreshSignedMediaUrls(settings, merged, { force: true })\n    : merged;\n  const mediaCount = records.reduce((count, record) => count + record.media.filter((asset) => Boolean(asset.storagePath)).length, 0);\n  return { records, message: `已恢复个人云端媒体 ${mediaCount} 项` };\n}\n\n'''
p = Path(supabase)
text = p.read_text(encoding="utf-8")
if marker not in text:
    raise SystemExit("supabase insertion marker not found")
p.write_text(text.replace(marker, helper + marker, 1), encoding="utf-8")

controller = "src/appController.ts"
replace_once(controller,
'''  refreshSignedMediaUrls,\n  saveUserProfileBinding,\n  signInStorageWithAccount,\n''',
'''  refreshSignedMediaUrls,\n  restorePersonalCloudMedia,\n  saveUserProfileBinding,\n  signInStorageWithAccount,\n''')
replace_once(controller,
'''          let nextRecords = recordsRef.current;\n          if (connectedSettings.supabase.syncMedia) {\n            nextRecords = await refreshSignedMediaUrls(connectedSettings, nextRecords, { force: true });\n            await replaceAllRecords(nextRecords);\n            setRecords(nextRecords);\n            void preloadRecordMedia(nextRecords);\n            lastMediaRefreshAt.current = Date.now();\n          }\n          setSettings(connectedSettings);\n          setPersonalCloudStatus("connected");\n          setCloudRecoveryNotice(connectedSettings.supabase.syncMedia ? "个人云端已经自动恢复，图片链接已重新签名。" : "个人云端已经自动恢复。");\n''',
'''          let nextRecords = recordsRef.current;\n          if (connectedSettings.supabase.syncMedia) {\n            const restored = await restorePersonalCloudMedia(connectedSettings, nextRecords);\n            nextRecords = restored.records;\n            await replaceAllRecords(nextRecords);\n            setRecords(nextRecords);\n            void preloadRecordMedia(nextRecords);\n            lastMediaRefreshAt.current = Date.now();\n          }\n          setSettings(connectedSettings);\n          setPersonalCloudStatus("connected");\n          setCloudRecoveryNotice(connectedSettings.supabase.syncMedia ? "个人云端已经自动恢复，海报与图片引用已重新载入。" : "个人云端已经自动恢复。");\n''')

print("Applied full personal-cloud media restore patch")
# Trigger the one-shot workflow after the workflow file itself exists.
# Retry after widening the regression assertion to the helper boundary.
