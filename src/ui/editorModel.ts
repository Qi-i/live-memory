import type { EventRecord } from "../domain";

/* One small edit snapshot rather than serializing potentially huge base64 media. */
export function editorSignature(record: EventRecord): string {
  return JSON.stringify({
    title: record.title,
    artists: record.artists,
    category: record.category,
    status: record.status,
    recordState: record.recordState,
    date: record.date,
    time: record.time || "",
    city: record.city,
    venue: record.venue,
    price: record.price,
    publicPriceRange: record.publicPriceRange || "",
    seat: record.seat || "",
    companions: record.companions,
    tags: record.tags,
    sourceUrl: record.sourceUrl || "",
    sourceChannel: record.sourceChannel,
    note: record.note || "",
    setlist: record.setlist,
    media: record.media.map(({ id, kind, updatedAt, storagePath }) => [id, kind, updatedAt, storagePath]),
  });
}

export function validateEditorRecord(record: EventRecord): string | null {
  if (!record.title.trim()) return "请填写演出名称";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date)) return "请选择有效的演出日期";
  const [year, month, day] = record.date.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return "演出日期无效";
  }
  if (record.price != null && (!Number.isFinite(record.price) || record.price < 0)) return "票价不能为负数或无效数字";
  return null;
}
