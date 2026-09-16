import { EventCategory, EventStatus, ImportDraft, createId, normalizeStatus } from "./domain";
import { knownDamaiMedia } from "./posterRegistry";

export function getDamaiItemId(url: string) {
  return /(?:itemId=|item\.html\?id=|item\.htm\?id=)(\d+)/i.exec(url)?.[1] || "";
}

export function extractUrls(text: string) {
  return Array.from(new Set((text.match(/https?:\/\/[^\s"'<>]+/g) || []).map((url) => url.replace(/[),，。]+$/, ""))));
}

export function cleanupDamaiTitle(value: string) {
  return String(value || "")
    .replace(/[【〖\[]\s*网上订票\s*[】〗\]]/g, "")
    .replace(/(?:\s*[-—–_|｜]\s*)?大麦网\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type TicketingPlatform = "damai" | "fenwandao" | "piaoxingqiu";

export function detectTicketingPlatform(url: string): TicketingPlatform | "" {
  if (/damai\.cn/i.test(url)) return "damai";
  if (/livelab\.com\.cn|fenwandao/i.test(url)) return "fenwandao";
  if (/piaoxingqiu\.com/i.test(url)) return "piaoxingqiu";
  return "";
}

export async function createDraftsFromText(text: string): Promise<ImportDraft[]> {
  const urls = extractUrls(text);
  const drafts: ImportDraft[] = [];
  for (const url of urls) {
    const platform = detectTicketingPlatform(url);
    if (platform === "damai") {
      drafts.push(await fetchDamaiDraft(url));
    } else if (platform) {
      drafts.push(await fetchTicketingDraft(url, platform));
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
  const knownMedia = knownDamaiMedia(itemId);
  try {
    const response = await fetchWithTimeout(`https://r.jina.ai/http://detail.damai.cn/item.htm?id=${itemId}`, 14000);
    if (!response.ok) throw new Error(`大麦页面读取失败：${response.status}`);
    const text = await response.text();
    const parsed = parseDamaiReaderText(text, url);
    return {
      ...fallback,
      ...parsed,
      posterUrl: parsed.posterUrl || knownMedia.posterUrl || undefined,
      seatMapUrl: parsed.seatMapUrl || knownMedia.seatMapUrl || undefined,
      sourceUrl: url,
      sourceChannel: "damai",
    };
  } catch {
    return {
      ...fallback,
      posterUrl: knownMedia.posterUrl || undefined,
      seatMapUrl: knownMedia.seatMapUrl || undefined,
    };
  }
}

async function fetchTicketingDraft(url: string, platform: Exclude<TicketingPlatform, "damai">): Promise<ImportDraft> {
  const fallback = basicUrlDraft(url, platform);
  try {
    const readerUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`;
    const response = await fetchWithTimeout(readerUrl, 14000);
    if (!response.ok) throw new Error(`${platform} 页面读取失败：${response.status}`);
    const pageText = await response.text();
    return {
      ...fallback,
      ...parseTicketingReaderText(pageText, url, platform),
      sourceUrl: url,
      sourceChannel: platform,
    };
  } catch {
    return fallback;
  }
}

export function parseTicketingReaderText(text: string, url: string, platform: TicketingPlatform): Partial<ImportDraft> {
  if (platform === "damai") {
    return { ...parseDamaiReaderText(text, url), sourceChannel: "damai", sourceUrl: url };
  }
  const structuredTitle =
    jsonStringForKey(text, "itemName") ||
    jsonStringForKey(text, "performanceName") ||
    jsonStringForKey(text, "showName") ||
    jsonStringForKey(text, "projectName");
  const readerTitle =
    /Title:\s*(.+)/i.exec(text)?.[1]?.trim() ||
    /#\s+(.+)/.exec(text)?.[1]?.trim() ||
    /(?:演出名称|项目名称)[:：]\s*([^\n]+)/.exec(text)?.[1]?.trim() ||
    "";
  const title = cleanupTicketingTitle(structuredTitle || readerTitle, platform);
  const showTime =
    jsonStringForKey(text, "showTime") ||
    jsonStringForKey(text, "startTime") ||
    jsonStringForKey(text, "performanceTime") ||
    jsonStringForKey(text, "showDate") ||
    /(?:演出时间|演出日期|时间)[:：]\s*([^\n]+)/.exec(text)?.[1] ||
    "";
  const venue = cleanVenue(
    jsonStringForKey(text, "venueName") ||
    jsonStringForKey(text, "stadiumName") ||
    jsonStringForKey(text, "venueTitle") ||
    /(?:演出场馆|场馆|演出地点|地点)[:：]\s*([^\n]+)/.exec(text)?.[1] ||
    "",
  );
  const city = normalizeCity(
    jsonStringForKey(text, "venueCityName") ||
    jsonStringForKey(text, "cityName") ||
    inferCity(`${title} ${venue} ${text}`),
  );
  const priceLine =
    jsonStringForKey(text, "priceRange") ||
    /(?:票档|票价)[:：]\s*([^\n]+)/.exec(text)?.[1] ||
    "";
  const posterUrl = findTicketingPoster(text);
  const date = normalizeDate(showTime || text);
  const fields = [title, date, venue, posterUrl].filter(Boolean).length;
  return {
    title: title || (platform === "fenwandao" ? "纷玩岛项目" : "票星球项目"),
    category: /音乐节|festival/i.test(title) ? "festival" : "concert",
    status: normalizeStatus(undefined, date),
    date: date || new Date().toISOString().slice(0, 10),
    time: normalizeTime(showTime || text),
    city,
    venue,
    artists: inferArtists(title),
    publicPriceRange: priceLine.slice(0, 120),
    posterUrl: posterUrl || undefined,
    sourceChannel: platform,
    sourceUrl: url,
    importConfidence: fields >= 4 ? 0.94 : fields >= 3 ? 0.86 : fields >= 2 ? 0.72 : 0.3,
  };
}

function cleanupTicketingTitle(value: string, platform: TicketingPlatform) {
  const platformName = platform === "fenwandao" ? "纷玩岛" : platform === "piaoxingqiu" ? "票星球" : "大麦";
  return cleanupDamaiTitle(value)
    .replace(new RegExp(`(?:\\s*[-—–_|｜]\\s*)?${platformName}(?:官网|官方)?\\s*$`, "i"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseDamaiReaderText(text: string, url: string): Partial<ImportDraft> {
  const structuredTitle = jsonStringForKey(text, "itemName");
  const readerTitle =
    /Title:\s*(.+)/i.exec(text)?.[1]?.trim() ||
    /#\s+(.+)/.exec(text)?.[1]?.trim() ||
    /项目名称[:：]\s*([^\n]+)/.exec(text)?.[1]?.trim() ||
    "";
  const title = cleanupDamaiTitle(structuredTitle || readerTitle);
  const showTime =
    jsonStringForKey(text, "showTime") ||
    /演出时间[:：]\s*([^\n]+)/.exec(text)?.[1] ||
    /时间[:：]\s*([^\n]+)/.exec(text)?.[1] ||
    "";
  const date = normalizeDate(showTime);
  const venue = cleanVenue(
    jsonStringForKey(text, "venueName") ||
    /演出场馆[:：]\s*([^\n]+)/.exec(text)?.[1] ||
    /场馆[:：]\s*([^\n]+)/.exec(text)?.[1] ||
    "",
  );
  const city = normalizeCity(
    jsonStringForKey(text, "venueCityName") ||
    jsonStringForKey(text, "cityName") ||
    inferCity(title || venue || text || url),
  );
  const priceLine =
    jsonStringForKey(text, "priceRange") ||
    /票档[:：]\s*([^\n]+)/.exec(text)?.[1] ||
    /票价[:：]\s*([^\n]+)/.exec(text)?.[1] ||
    "";
  const posterUrl = findDamaiPoster(text);
  const seatMapUrl = findDamaiSeatMap(text);
  const artists = inferArtists(title);
  const structuredFields = [structuredTitle, venue, posterUrl].filter(Boolean).length;

  return {
    title: title || "大麦项目",
    category: /音乐节|festival/i.test(title) ? "festival" : "concert",
    status: normalizeStatus(undefined, date),
    date: date || new Date().toISOString().slice(0, 10),
    time: normalizeTime(showTime || text),
    city,
    venue,
    address: jsonStringForKey(text, "venueAddr") || undefined,
    artists,
    publicPriceRange: priceLine.slice(0, 120),
    posterUrl: posterUrl || undefined,
    seatMapUrl: seatMapUrl || undefined,
    importConfidence: structuredFields >= 3 ? 0.96 : structuredFields >= 2 ? 0.9 : title ? 0.78 : 0.42,
  };
}


function jsonStringForKey(text: string, key: string) {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i").exec(text);
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1].replace(/\\\//g, "/").replace(/\\n/g, " ").trim();
  }
}

function allJsonStringsForKey(text: string, key: string) {
  const values: string[] = [];
  const regex = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    try {
      values.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      values.push(match[1].replace(/\\\//g, "/"));
    }
  }
  return values;
}

function findTicketingPoster(text: string) {
  for (const key of ["itemPic", "posterUrl", "posterPic", "verticalPic", "projectPic", "coverUrl", "coverImage", "imageUrl", "performancePic"]) {
    const value = cleanImageUrl(jsonStringForKey(text, key));
    if (isUsablePoster(value)) return value;
  }
  for (const key of ["picUrl", "image", "url"]) {
    const value = allJsonStringsForKey(text, key).map(cleanImageUrl).find(isUsablePoster);
    if (value) return value;
  }
  return bestMarkdownImage(text, false);
}

function findDamaiPoster(text: string) {
  for (const key of ["itemPic", "posterUrl", "posterPic", "verticalPic", "projectPic"]) {
    const value = cleanImageUrl(jsonStringForKey(text, key));
    if (isUsablePoster(value)) return value;
  }
  const structured = allJsonStringsForKey(text, "picUrl").map(cleanImageUrl).find(isUsablePoster);
  return structured || bestMarkdownImage(text, false);
}

function findDamaiSeatMap(text: string) {
  for (const key of ["seatMapUrl", "seatMapPic", "seatPic", "seatImg", "venueMap", "venueMapUrl", "areaMap", "areaMapUrl", "mapPic"]) {
    const value = cleanImageUrl(jsonStringForKey(text, key));
    if (isUsableImage(value)) return value;
  }
  return bestMarkdownImage(text, true);
}

function bestMarkdownImage(text: string, seatMap: boolean) {
  const candidates: Array<{ url: string; score: number }> = [];
  const regex = /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const url = cleanImageUrl(match[1]);
    if (!isUsableImage(url)) continue;
    const nearby = text.slice(Math.max(0, match.index - 260), Math.min(text.length, regex.lastIndex + 260));
    let score = /img\.alicdn\.com|gw\.alicdn\.com/i.test(url) ? 2 : 0;
    if (/bao\/uploaded|item|perform|project|poster/i.test(url)) score += 4;
    if (seatMap) {
      score += /座位图|座位分布|票区图|座位示意|场馆图|看台分布|区域图/.test(nearby) ? 12 : -5;
    } else {
      if (/海报|项目图片|演出图片|itemPic|主图/.test(nearby)) score += 7;
      if (/座位图|票区图|二维码|服务说明/.test(nearby)) score -= 8;
    }
    candidates.push({ url, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.score > 0 ? candidates[0].url : "";
}

function cleanImageUrl(value: string) {
  let url = String(value || "").trim().replace(/\\\//g, "/").replace(/&amp;/g, "&");
  if (url.startsWith("//")) url = `https:${url}`;
  const nestedHttps = url.lastIndexOf("https://");
  if (nestedHttps > 8) url = url.slice(nestedHttps);
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function isUsableImage(url: string) {
  return Boolean(url) && !/qcode|qrcode|projqcode|logo|avatar|icon|45-45|service/i.test(url);
}

function isUsablePoster(url: string) {
  return isUsableImage(url) && !/seat|area[_-]?map|venue[_-]?map/i.test(url);
}

function cleanVenue(value: string) {
  const text = String(value || "").trim();
  return (text.includes("|") ? text.split("|").pop() || text : text).trim();
}

function normalizeCity(value: string) {
  const city = String(value || "").trim();
  return city.replace(/市$/, "");
}

function basicUrlDraft(url: string, sourceChannel: ImportDraft["sourceChannel"] = ""): ImportDraft {
  const platform = sourceChannel || detectTicketingPlatform(url);
  const title = platform === "damai" ? "大麦项目" : platform === "fenwandao" ? "纷玩岛项目" : platform === "piaoxingqiu" ? "票星球项目" : "链接导入项目";
  return {
    id: createId("draft"),
    title,
    category: "concert",
    status: "planned",
    date: new Date().toISOString().slice(0, 10),
    city: "",
    venue: "",
    artists: [],
    sourceChannel: platform,
    sourceUrl: url,
    importConfidence: 0.25,
  };
}

function parsePlainTextDraft(text: string): ImportDraft {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const firstLine = lines.find((line) => !/^(大麦|纷玩岛|票星球|演出详情|订单详情)$/.test(line)) || "文本导入项目";
  const date = normalizeDate(text) || new Date().toISOString().slice(0, 10);
  const category: EventCategory = /音乐节/i.test(text) ? "festival" : "concert";
  const status: EventStatus = normalizeStatus(undefined, date);
  const venue = /(?:演出场馆|场馆|演出地点|地点)[:：]?\s*([^\n]+)/.exec(text)?.[1]?.trim() || "";
  const publicPriceRange = /(?:票档|票价)[:：]?\s*([^\n]+)/.exec(text)?.[1]?.trim() || "";
  const sourceChannel: ImportDraft["sourceChannel"] = /纷玩岛/.test(text) ? "fenwandao" : /票星球/.test(text) ? "piaoxingqiu" : /大麦/.test(text) ? "damai" : "";
  const usefulFields = [date, venue, inferCity(text)].filter(Boolean).length;
  return {
    id: createId("draft"),
    title: firstLine.slice(0, 80),
    category,
    status,
    date,
    time: normalizeTime(text),
    city: inferCity(text),
    venue,
    artists: inferArtists(firstLine),
    publicPriceRange: publicPriceRange.slice(0, 120),
    sourceChannel,
    importConfidence: usefulFields >= 2 ? 0.62 : 0.45,
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
  const clean = cleanupDamaiTitle(title)
    .replace(/^[【〖\[][^】〗\]]+[】〗\]]/, "")
    .replace(/\d{4}\s*[「“]/, "「")
    .replace(/世界巡回演唱会.*$/, "")
    .replace(/巡回演唱会.*$/, "")
    .replace(/演唱会.*$/, "")
    .replace(/音乐节.*$/, "")
    .replace(/[「“].*$/, "")
    .replace(/\d{4}\s*$/, "")
    .trim();
  if (!clean || clean.length > 24) return [];
  return clean.split(/\s*\/\s*|\s*、\s*/).filter(Boolean);
}

function fetchWithTimeout(url: string, milliseconds: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), milliseconds);
  return fetch(url, { signal: controller.signal }).finally(() => window.clearTimeout(timer));
}
