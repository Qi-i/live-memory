import { EventRecord, MediaAsset, createId } from "./domain";
import { makeMedia, nowIso } from "./media";

type SeedInput = Omit<EventRecord, "schemaVersion" | "media" | "lineup" | "favorite" | "createdAt" | "updatedAt"> & { poster?: string };

function demoAsset(file: string) {
  return `${import.meta.env.BASE_URL}demo/${file}`;
}

function seedRecord(input: SeedInput): EventRecord {
  const timestamp = "2026-08-01T00:00:00.000Z";
  const media: MediaAsset[] = input.poster
    ? [makeMedia(input.id, "poster", input.poster, "演出海报", "sample")]
    : [];
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
    colors: ["#171a1f", "#d7f05a"],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const demoNote = "演出名称、日期、城市、场馆和海报来自公开票务信息；票价与座位为界面演示数据。";

export const seedRecords: EventRecord[] = [
  seedRecord({
    id: "guest-zhou-shen-zhengzhou-2026",
    title: "周深2026「深深的」巡回演唱会-郑州站",
    artists: ["周深"], category: "concert", status: "planned", recordState: "normal",
    date: "2026-06-28", time: "19:30", city: "郑州",
    venue: "郑州奥林匹克体育中心·体育场", price: 929, seat: "内场 B 区 18 排 06 座",
    companions: [], sourceChannel: "official", importConfidence: 1,
    tags: ["演示", "演唱会"], setlist: [], note: demoNote,
    colors: ["#34236b", "#d7c8ff"], poster: demoAsset("zhou-shen.webp"),
  }),
  seedRecord({
    id: "guest-xue-zhiqian-luoyang-2026",
    title: "薛之谦“万兽之王”巡回演唱会-洛阳站",
    artists: ["薛之谦"], category: "concert", status: "watched", recordState: "normal",
    date: "2026-06-14", time: "19:30", city: "洛阳",
    venue: "洛阳奥林匹克中心体育场", price: 917, seat: "内场 A5 区 12 排 18 座",
    companions: [], sourceChannel: "official", importConfidence: 1,
    tags: ["演示", "演唱会"], setlist: [], note: demoNote,
    colors: ["#22272d", "#d9dde1"], poster: demoAsset("xue-zhiqian.webp"),
  }),
  seedRecord({
    id: "guest-zhang-jie-urumqi-2025",
    title: "2025张杰未·LIVE—「开往1982」世界巡回演唱会-乌鲁木齐站",
    artists: ["张杰"], category: "concert", status: "watched", recordState: "normal",
    date: "2025-08-17", time: "19:30", city: "乌鲁木齐",
    venue: "乌鲁木齐奥体中心体育场", price: 1280, seat: "内场 B3 区 09 排 22 座",
    companions: [], sourceChannel: "official", importConfidence: 1,
    tags: ["演示", "演唱会"], setlist: [], note: demoNote,
    colors: ["#0e3550", "#79c4de"], poster: demoAsset("zhang-jie.jpg"),
  }),
  seedRecord({
    id: "guest-wang-sulong-zhengzhou-2024",
    title: "汪苏泷2024「十万伏特」巡回演唱会-郑州站",
    artists: ["汪苏泷"], category: "concert", status: "watched", recordState: "normal",
    date: "2024-08-18", time: "19:30", city: "郑州",
    venue: "郑州奥林匹克体育中心体育场", price: 680, seat: "看台 A 区 15 排 08 座",
    companions: [], sourceChannel: "official", importConfidence: 1,
    tags: ["演示", "演唱会"], setlist: [], note: demoNote,
    colors: ["#20365a", "#e792b5"], poster: demoAsset("wang-sulong.jpg"),
  }),
  seedRecord({
    id: "guest-zhao-lei-xian-2024",
    title: "赵雷“没有信号”2024巡演-西安站",
    artists: ["赵雷"], category: "concert", status: "watched", recordState: "normal",
    date: "2024-03-10", time: "19:30", city: "西安",
    venue: "西安奥体中心体育馆", price: 580, seat: "看台 102 区 08 排 15 座",
    companions: [], sourceChannel: "official", importConfidence: 1,
    tags: ["演示", "巡演"], setlist: [], note: demoNote,
    colors: ["#49433d", "#d7c4a3"], poster: demoAsset("zhao-lei.png"),
  }),
];
