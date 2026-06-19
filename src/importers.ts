import { EventCategory, EventStatus, ImportDraft, createId, normalizeStatus } from "./domain";

export function getDamaiItemId(url: string) {
  return /(?:itemId=|item\.html\?id=|item\.htm\?id=)(\d+)/i.exec(url)?.[1] || "";
}

export function extractUrls(text: string) {
  return Array.from(new Set((text.match(/https?:\/\/[^\s"'<>]+/g) || []).map((url) => url.replace(/[),，。]+$/, ""))));
}

export async function createDraftsFromText(text: string): Promise<ImportDraft[]> {
  const urls = extractUrls(text);
  const drafts: ImportDraft[] = [];
  for (const url of urls) {
    if (/damai\.cn/i.test(url)) {
      drafts.push(await fetchDamaiDraft(url));
    } else {
      drafts.push(basicUrlDraft(url));
    }
  }
  if (!drafts.length && text.trim()) drafts.push(parsePlainTextDraft(text));
  return drafts;
}

export async function fetchDamaiDraft(url: string): Promise<ImportDraft> {
  const itemId = getDamaiItemId(url);
  const fallback = basicUrlDraft(url, "damai");
  if (!itemId) return fallback;
  try {
    const response = await fetchWithTimeout(`https://r.jina.ai/http://detail.damai.cn/item.htm?id=${itemId}`, 14000);
    const text = await response.text();
    return { ...fallback, ...parseDamaiReaderText(text, url), sourceUrl: url, sourceChannel: "damai" };
  } catch {
    return fallback;
  }
}

function parseDamaiReaderText(text: string, url: string): Partial<ImportDraft> {
  const title =
    /Title:\s*(.+)/i.exec(text)?.[1]?.trim() ||
    /#\s+(.+)/.exec(text)?.[1]?.trim() ||
    /项目名称[:：]\s*(.+)/.exec(text)?.[1]?.trim() ||
    "";
  const image = /!\[[^\]]*]\((https?:\/\/[^)]+)\)/.exec(text)?.[1] || /(https?:\/\/[^)\s"]+\.(?:jpg|jpeg|png|webp)[^)\s"]*)/i.exec(text)?.[1] || "";
  const date = normalizeDate(/演出时间[:：]\s*([^\n]+)/.exec(text)?.[1] || /时间[:：]\s*([^\n]+)/.exec(text)?.[1] || "");
  const venueLine = /演出场馆[:：]\s*([^\n]+)/.exec(text)?.[1] || /场馆[:：]\s*([^\n]+)/.exec(text)?.[1] || "";
  const priceLine = /票档[:：]\s*([^\n]+)/.exec(text)?.[1] || /票价[:：]\s*([^\n]+)/.exec(text)?.[1] || "";
  const city = inferCity(title || venueLine || url);
  const artists = inferArtists(title);
  const category = /音乐节|festival/i.test(title) ? "festival" : "concert";

  return {
    title: title || "大麦项目",
    category,
    status: normalizeStatus(undefined, date),
    date: date || new Date().toISOString().slice(0, 10),
    time: normalizeTime(/(\d{1,2}:\d{2})/.exec(text)?.[1] || ""),
    city,
    venue: venueLine.replace(/^.*?\|/, "").trim(),
    artists,
    publicPriceRange: priceLine.slice(0, 80),
    posterUrl: image,
    importConfidence: title ? 0.78 : 0.42,
  };
}

function basicUrlDraft(url: string, sourceChannel: ImportDraft["sourceChannel"] = ""): ImportDraft {
  return {
    id: createId("draft"),
    title: /damai\.cn/i.test(url) ? "大麦项目" : "链接导入项目",
    category: "concert",
    status: "planned",
    date: new Date().toISOString().slice(0, 10),
    city: "",
    venue: "",
    artists: [],
    sourceChannel,
    sourceUrl: url,
    importConfidence: 0.25,
  };
}

function parsePlainTextDraft(text: string): ImportDraft {
  const firstLine = text.split(/\n/).map((line) => line.trim()).find(Boolean) || "文本导入项目";
  const date = normalizeDate(text) || new Date().toISOString().slice(0, 10);
  const category: EventCategory = /音乐节/i.test(text) ? "festival" : "concert";
  const status: EventStatus = normalizeStatus(undefined, date);
  return {
    id: createId("draft"),
    title: firstLine.slice(0, 80),
    category,
    status,
    date,
    time: normalizeTime(text),
    city: inferCity(text),
    venue: "",
    artists: inferArtists(firstLine),
    sourceChannel: "",
    importConfidence: 0.45,
  };
}

function normalizeDate(text: string) {
  const match = /(\d{4})[./年-]\s*(\d{1,2})[./月-]\s*(\d{1,2})/.exec(text);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeTime(text: string) {
  const match = /(\d{1,2}):(\d{2})/.exec(text);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function inferCity(text: string) {
  const cities = ["乌鲁木齐", "郑州", "洛阳", "福州", "武汉", "西安", "合肥", "太原", "杭州", "上海", "北京", "广州", "深圳", "南京", "成都", "重庆"];
  return cities.find((city) => text.includes(city)) || "";
}

function inferArtists(title = "") {
  const clean = title
    .replace(/^【[^】]+】/, "")
    .replace(/巡回演唱会.*$/, "")
    .replace(/演唱会.*$/, "")
    .replace(/音乐节.*$/, "")
    .replace(/[「“].*$/, "")
    .trim();
  if (!clean || clean.length > 24) return [];
  return clean.split(/\s*\/\s*|\s*、\s*/).filter(Boolean);
}

function fetchWithTimeout(url: string, milliseconds: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), milliseconds);
  return fetch(url, { signal: controller.signal }).finally(() => window.clearTimeout(timer));
}
