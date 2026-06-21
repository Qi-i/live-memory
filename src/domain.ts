export type EventCategory = "concert" | "festival" | "livehouse" | "theatre" | "other";
export type EventStatus = "watched" | "planned" | "wish";
export type RecordState = "normal" | "rescheduled" | "cancelled" | "refunded";
export type MediaKind = "poster" | "ticket" | "seatMap" | "livePhoto" | "other";
export type SourceChannel = "" | "damai" | "fenwandao" | "maoyan" | "official" | "onsite" | "transfer" | "other";

export interface GeoPoint {
  lat: number;
  lng: number;
  provider?: "wgs84" | "gcj02" | "bd09";
}

export interface Performer {
  name: string;
  role?: "artist" | "guest" | "host" | "band" | "lineup";
}

export interface MediaAsset {
  id: string;
  recordId: string;
  kind: MediaKind;
  src: string;
  title?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  size?: number;
  storagePath?: string;
  source?: "local" | "supabase" | "damai" | "sample" | "external";
  createdAt: string;
  updatedAt: string;
}

export interface EventRecord {
  schemaVersion: 2;
  id: string;
  title: string;
  category: EventCategory;
  status: EventStatus;
  recordState: RecordState;
  date: string;
  time?: string;
  city: string;
  venue: string;
  address?: string;
  coordinates?: GeoPoint;
  artists: string[];
  lineup: Performer[];
  price?: number | null;
  publicPriceRange?: string;
  seat?: string;
  companions: string[];
  tags: string[];
  note?: string;
  setlist: string[];
  sourceChannel: SourceChannel;
  sourceUrl?: string;
  importConfidence?: number;
  media: MediaAsset[];
  favorite: boolean;
  colors: [string, string];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ImportDraft {
  id: string;
  title: string;
  category: EventCategory;
  status: EventStatus;
  date: string;
  time?: string;
  city: string;
  venue: string;
  address?: string;
  artists: string[];
  publicPriceRange?: string;
  price?: number | null;
  sourceChannel: SourceChannel;
  sourceUrl?: string;
  posterUrl?: string;
  note?: string;
  importConfidence: number;
}

export interface MapConfig {
  provider: "none" | "amap" | "baidu";
  amapKey: string;
  amapSecurityCode: string;
  baiduAk: string;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  mediaBucket: string;
  syncMedia: boolean;
  ownerKey: string;
}

export interface AccountProfile {
  username: string;
  nickname: string;
  avatarUrl: string;
  recoveryEmail: string;
}

export interface AccountBackupConfig {
  intervalHours: number;
  lastBackupAt?: string;
}

export type StorageMode = "local" | "supabase";

export interface AppSettings {
  defaultView: ArchiveView;
  posterColumns: number;
  storageMode: StorageMode;
  onboardingComplete: boolean;
  account: AccountProfile;
  accountBackup: AccountBackupConfig;
  map: MapConfig;
  supabase: SupabaseConfig;
  lastSyncAt?: string;
}

export type ArchiveView =
  | "poster"
  | "wallet"
  | "ticket"
  | "timeline"
  | "price"
  | "summary"
  | "calendar"
  | "venue"
  | "list";

export interface Filters {
  query: string;
  categories: EventCategory[];
  statuses: EventStatus[];
  years: string[];
  cities: string[];
  artists: string[];
  tags: string[];
}

export interface StorageHealth {
  localRecords: number;
  mediaAssets: number;
  localOnlyMedia: number;
  remoteMedia: number;
  lastSyncAt?: string;
}

export const categoryLabels: Record<EventCategory, string> = {
  concert: "演唱会",
  festival: "音乐节",
  livehouse: "Livehouse",
  theatre: "剧场",
  other: "其他",
};

export const statusLabels: Record<EventStatus, string> = {
  watched: "已看",
  planned: "待看",
  wish: "想看",
};

export const recordStateLabels: Record<RecordState, string> = {
  normal: "正常",
  rescheduled: "改期",
  cancelled: "取消",
  refunded: "退款",
};

export const mediaKindLabels: Record<MediaKind, string> = {
  poster: "海报",
  ticket: "票根",
  seatMap: "座位图",
  livePhoto: "现场照",
  other: "附件",
};

export const viewLabels: Record<ArchiveView, string> = {
  poster: "海报",
  wallet: "票夹",
  ticket: "纪念票根",
  timeline: "时间线",
  price: "票价",
  summary: "汇总",
  calendar: "日历",
  venue: "场馆/城市",
  list: "列表",
};

export const sourceLabels: Record<SourceChannel, string> = {
  "": "未记录",
  damai: "大麦",
  fenwandao: "纷玩岛",
  maoyan: "猫眼",
  official: "官方",
  onsite: "现场",
  transfer: "转票",
  other: "其他",
};

export const storageModeLabels: Record<StorageMode, string> = {
  local: "保存在当前设备",
  supabase: "Supabase 完整同步",
};

export const defaultSettings: AppSettings = {
  defaultView: "poster",
  posterColumns: 4,
  storageMode: "local",
  onboardingComplete: false,
  account: {
    username: "",
    nickname: "旅行者",
    avatarUrl: "",
    recoveryEmail: "",
  },
  accountBackup: {
    intervalHours: 24,
  },
  map: {
    provider: "none",
    amapKey: "",
    amapSecurityCode: "",
    baiduAk: "",
  },
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL || "",
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
    mediaBucket: import.meta.env.VITE_SUPABASE_MEDIA_BUCKET || "echo-media",
    syncMedia: true,
    ownerKey: "",
  },
};

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string) {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9]{4,32}$/.test(username)) {
    throw new Error("用户名需为 4-32 位英文字母或数字");
  }
  return username;
}

export function validatePassword(value: string) {
  if (value.length < 8) throw new Error("密码至少需要 8 位");
  return value;
}

export function validateRecoveryEmail(value: string) {
  const email = value.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("请填写有效的邮箱地址");
  return email;
}

export function createId(prefix = "record") {
  const value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function isPastRecord(record: EventRecord) {
  return record.date < todayIso();
}

export function daysFromToday(date: string) {
  const start = new Date(`${todayIso()}T00:00:00`);
  const target = new Date(`${date}T00:00:00`);
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}

export function formatRelativeDay(date: string) {
  const days = daysFromToday(date);
  if (days === 0) return "今天";
  if (days > 0) return `还有 ${days} 天`;
  return `已过去 ${Math.abs(days)} 天`;
}

export function formatDateCn(date: string, time?: string) {
  if (!date) return "日期待补";
  const parsed = new Date(`${date}T00:00:00`);
  const weekday = "日一二三四五六"[parsed.getDay()];
  return `${date.replaceAll("-", "年").replace(/年(\d{2})年/, "年$1月")}日 周${weekday}${time ? ` ${time}` : ""}`;
}

export function splitTextList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "")
    .split(/[,\n，、/|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeCategory(value: unknown): EventCategory {
  return value === "concert" || value === "festival" || value === "livehouse" || value === "theatre" || value === "other"
    ? value
    : "other";
}

export function normalizeStatus(value: unknown, date?: string): EventStatus {
  if (value === "watched" || value === "planned" || value === "wish") return value;
  return date && date < todayIso() ? "watched" : "planned";
}

export function normalizeSource(value: unknown): SourceChannel {
  const source = String(value || "");
  if (source === "damai" || source === "fenwandao" || source === "maoyan" || source === "official" || source === "onsite" || source === "transfer" || source === "other") {
    return source;
  }
  return "";
}

export function normalizeRecordState(value: unknown): RecordState {
  return value === "rescheduled" || value === "cancelled" || value === "refunded" || value === "normal" ? value : "normal";
}

export function primaryMedia(record: EventRecord, kinds: MediaKind[] = ["poster", "ticket", "seatMap", "livePhoto"]) {
  return kinds.map((kind) => record.media.find((item) => item.kind === kind)).find(Boolean);
}

export function mediaByKind(record: EventRecord, kind: MediaKind) {
  return record.media.filter((item) => item.kind === kind);
}
