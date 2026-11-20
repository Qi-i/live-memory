import type { EventRecord } from "../domain";

export type QiHubMemoryOperation = "create" | "update" | "trash" | "restore";
export interface QiHubMemoryCommand {
  operation: QiHubMemoryOperation;
  id?: string;
  expectedRevision?: number;
  fields?: Record<string, unknown>;
}

const categories = new Set(["concert", "festival", "livehouse", "theatre", "other"]);
const statuses = new Set(["watched", "planned", "wish"]);
const channels = new Set(["", "damai", "fenwandao", "piaoxingqiu",
  "maoyan", "official", "onsite", "transfer", "other"]);
const editable = new Set([
  "title", "category", "status", "date", "time", "city", "venue",
  "address", "artists", "price", "seat", "companions", "tags",
  "note", "setlist", "sourceChannel", "sourceUrl", "favorite",
]);

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Explicit metadata allowlist; never accept native media, owner, revisions,
 * record IDs, server-managed timestamps or private Storage references. */
export function composeQiHubMemoryRecord(
  original: EventRecord,
  fields: Record<string, unknown>,
): EventRecord {
  if (!fields || typeof fields !== "object" || Array.isArray(fields) ||
      Object.keys(fields).some(key => !editable.has(key))) {
    throw Error("QIHUB_MEMORY_INVALID_FIELDS");
  }
  const next: EventRecord = {...original};
  for (const [key, raw] of Object.entries(fields)) {
    if (key === "artists" || key === "companions" || key === "tags" || key === "setlist") {
      if (!Array.isArray(raw) || raw.length > 100 ||
          raw.some(item => typeof item !== "string" || item.length > 300)) {
        throw Error("QIHUB_MEMORY_INVALID_LIST");
      }
      (next as unknown as Record<string, unknown>)[key] =
        raw.map(item => (item as string).trim()).filter(Boolean);
    } else if (key === "favorite") {
      if (typeof raw !== "boolean") throw Error("QIHUB_MEMORY_INVALID_FAVORITE");
      next.favorite = raw;
    } else if (key === "price") {
      if (raw !== null && (typeof raw !== "number" || !Number.isFinite(raw) ||
          raw < 0 || raw > 1_000_000)) throw Error("QIHUB_MEMORY_INVALID_PRICE");
      next.price = raw as number | null;
    } else {
      if (typeof raw !== "string" ||
          raw.length > (key === "note" ? 20000 : 2000)) {
        throw Error("QIHUB_MEMORY_INVALID_TEXT");
      }
      (next as unknown as Record<string, unknown>)[key] = raw.trim();
    }
  }
  if (!next.title?.trim() || next.title.length > 500 || !validDate(next.date) ||
      !categories.has(next.category) || !statuses.has(next.status) ||
      !channels.has(next.sourceChannel)) {
    throw Error("QIHUB_MEMORY_INVALID_EVENT");
  }
  if (next.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(next.time)) {
    throw Error("QIHUB_MEMORY_INVALID_TIME");
  }
  if (next.sourceUrl && !/^https?:\/\//.test(next.sourceUrl)) {
    throw Error("QIHUB_MEMORY_INVALID_URL");
  }
  if ("artists" in fields) {
    const retained=original.lineup.filter(item=>item.role && item.role!=="artist");
    next.lineup=[
      ...next.artists.map(name=>({name,role:"artist" as const})),
      ...retained.filter(item=>!next.artists.includes(item.name)),
    ];
  }
  return next;
}
