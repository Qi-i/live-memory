import { EventRecord, MediaAsset, createId } from "./domain";
import { makeMedia, nowIso } from "./media";

type SeedInput = Omit<EventRecord, "schemaVersion" | "media" | "lineup" | "favorite" | "createdAt" | "updatedAt"> & {
  poster?: string;
  seatMap?: string;
};

function seedRecord(input: SeedInput): EventRecord {
  const timestamp = "2026-06-19T00:00:00.000Z";
  const media: MediaAsset[] = [];
  if (input.poster) media.push(makeMedia(input.id, "poster", input.poster, "示例海报", "sample"));
  if (input.seatMap) media.push(makeMedia(input.id, "seatMap", input.seatMap, "示例座位图", "sample"));
  return {
    ...input,
    schemaVersion: 2,
    lineup: input.artists.map((name) => ({ name, role: "artist" })),
    media,
    favorite: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function demoPoster(title: string, subtitle: string, colorA: string, colorB: string) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1200">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="${colorA}" />
          <stop offset="1" stop-color="${colorB}" />
        </linearGradient>
        <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0H0v48" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/>
        </pattern>
      </defs>
      <rect width="900" height="1200" fill="url(#bg)" />
      <rect width="900" height="1200" fill="url(#grid)" opacity=".42" />
      <circle cx="720" cy="210" r="130" fill="rgba(255,255,255,.28)" />
      <circle cx="170" cy="930" r="210" fill="rgba(0,0,0,.18)" />
      <text x="76" y="140" fill="#fffdf5" font-family="Arial, sans-serif" font-size="42" font-weight="800">LIVE MEMORY SAMPLE</text>
      <text x="76" y="570" fill="#fffdf5" font-family="Arial, sans-serif" font-size="92" font-weight="900">${title}</text>
      <text x="76" y="665" fill="#fffdf5" font-family="Arial, sans-serif" font-size="58" font-weight="800">${subtitle}</text>
      <text x="76" y="1050" fill="#fffdf5" font-family="Arial, sans-serif" font-size="36" font-weight="800">poster / ticket / seat map / live photo</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function blankRecord(): EventRecord {
  const id = createId("record");
  const timestamp = nowIso();
  return {
    schemaVersion: 2,
    id,
    title: "",
    category: "concert",
    status: "planned",
    recordState: "normal",
    date: new Date().toISOString().slice(0, 10),
    time: "19:30",
    city: "",
    venue: "",
    artists: [],
    lineup: [],
    price: null,
    seat: "",
    companions: [],
    tags: [],
    setlist: [],
    sourceChannel: "",
    media: [],
    favorite: false,
    colors: ["#101418", "#dfff4f"],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export const seedRecords: EventRecord[] = [
  seedRecord({
    id: "demo-poster-concert",
    title: "示例演唱会：回声巡演",
    artists: ["示例歌手"],
    category: "concert",
    status: "watched",
    recordState: "normal",
    date: "2026-06-19",
    time: "19:30",
    city: "上海",
    venue: "示例体育馆",
    price: 580,
    seat: "看台 A 区 12 排 08 座",
    companions: ["朋友 A"],
    sourceChannel: "official",
    importConfidence: 1,
    tags: ["示例", "演唱会"],
    setlist: ["开场曲", "返场曲"],
    note: "这是一条公开演示记录。你的真实票根、座位图和现场照片不会进入 GitHub 仓库。",
    colors: ["#101418", "#65dfcf"],
    poster: demoPoster("ECHO TOUR", "CONCERT", "#101418", "#65dfcf"),
  }),
  seedRecord({
    id: "demo-poster-festival",
    title: "示例音乐节：夏日双日票",
    artists: ["乐队甲", "歌手乙", "DJ 丙"],
    category: "festival",
    status: "planned",
    recordState: "normal",
    date: "2026-08-08",
    time: "15:30",
    city: "成都",
    venue: "示例音乐公园",
    price: 399,
    seat: "双日通票",
    companions: [],
    sourceChannel: "official",
    importConfidence: 1,
    tags: ["示例", "音乐节", "多艺人"],
    setlist: [],
    note: "音乐节和拼盘演出可以保存多位艺人、每日票根和现场精选照片。",
    colors: ["#ff6b8a", "#dfff4f"],
    poster: demoPoster("SUMMER STAGE", "FESTIVAL", "#ff6b8a", "#dfff4f"),
  }),
  seedRecord({
    id: "demo-poster-livehouse",
    title: "示例 Livehouse：午夜小场",
    artists: ["独立乐队"],
    category: "livehouse",
    status: "wish",
    recordState: "normal",
    date: "2026-10-24",
    time: "20:30",
    city: "杭州",
    venue: "示例 Livehouse",
    price: null,
    publicPriceRange: "180-280 CNY",
    seat: "站席",
    companions: [],
    sourceChannel: "official",
    importConfidence: 1,
    tags: ["示例", "Livehouse"],
    setlist: [],
    note: "可以把它替换成你自己的第一场记录，或直接导入备份恢复私人档案。",
    colors: ["#43c8ff", "#ff8c5a"],
    poster: demoPoster("MIDNIGHT ROOM", "LIVEHOUSE", "#43c8ff", "#ff8c5a"),
  }),
];
