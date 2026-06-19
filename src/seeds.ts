import { EventRecord, MediaAsset, createId } from "./domain";
import { makeMedia, nowIso } from "./media";
import { posterByName } from "./posterRegistry";

type SeedInput = Omit<EventRecord, "schemaVersion" | "media" | "lineup" | "favorite" | "createdAt" | "updatedAt"> & {
  poster?: string;
  seatMap?: string;
};

function seedRecord(input: SeedInput): EventRecord {
  const timestamp = "2026-06-19T00:00:00.000Z";
  const media: MediaAsset[] = [];
  if (input.poster) media.push(makeMedia(input.id, "poster", input.poster, "主海报", input.poster.startsWith("http") ? "external" : "sample"));
  if (input.seatMap) media.push(makeMedia(input.id, "seatMap", input.seatMap, "座位图", input.seatMap.startsWith("http") ? "external" : "sample"));
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
    colors: ["#101418", "#dfff4f"],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const zhouPoster =
  "https://img.alicdn.com/bao/uploaded/https://img.alicdn.com/imgextra/i3/2251059038/O1CN01DdC1Sn2GdSmcwNS5Y_!!2251059038.jpg";
const zhouSeatMap = "https://img.alicdn.com/imgextra/i3/2251059038/O1CN01EzZ9Pv2GdSmg0UtrX_!!2251059038.jpg";
const xuePoster =
  "https://img.alicdn.com/bao/uploaded/https://img.alicdn.com/imgextra/i2/2251059038/O1CN01JLdVX82GdSmhDSJH7_!!2251059038.jpg";
const xueSeatMap = "https://img.alicdn.com/imgextra/i4/2251059038/O1CN019yRXWV2GdSmliiNrn_!!2251059038.jpg";

export const seedRecords: EventRecord[] = [
  seedRecord({
    id: "damai-1045813707030-20260627",
    title: "【郑州】周深2026「深深的」巡回演唱会-郑州站",
    artists: ["周深"],
    category: "concert",
    status: "planned",
    recordState: "normal",
    date: "2026-06-27",
    time: "19:30",
    city: "郑州",
    venue: "郑州奥林匹克体育中心 洋河·梦之蓝体育场",
    price: null,
    publicPriceRange: "待公开/待补充",
    seat: "座位待定",
    companions: [],
    sourceChannel: "damai",
    sourceUrl: "https://m.damai.cn/shows/item.html?itemId=1045813707030&from=appshare",
    importConfidence: 0.92,
    tags: ["巡演", "深深的", "大麦公开页"],
    setlist: [],
    note: "由大麦公开项目页导入。请补充实际票价、座位、同行人和观演照片。",
    colors: ["#162b55", "#68d0ff"],
    poster: zhouPoster,
    seatMap: zhouSeatMap,
  }),
  seedRecord({
    id: "damai-1045813707030-20260628",
    title: "【郑州】周深2026「深深的」巡回演唱会-郑州站",
    artists: ["周深"],
    category: "concert",
    status: "planned",
    recordState: "normal",
    date: "2026-06-28",
    time: "19:30",
    city: "郑州",
    venue: "郑州奥林匹克体育中心 洋河·梦之蓝体育场",
    price: null,
    publicPriceRange: "待公开/待补充",
    seat: "座位待定",
    companions: [],
    sourceChannel: "damai",
    sourceUrl: "https://m.damai.cn/shows/item.html?itemId=1045813707030&from=appshare",
    importConfidence: 0.92,
    tags: ["巡演", "深深的", "大麦公开页"],
    setlist: [],
    note: "每天单独成场保存，方便记录不同座位、票价、同行人和现场照片。",
    colors: ["#162b55", "#68d0ff"],
    poster: zhouPoster,
    seatMap: zhouSeatMap,
  }),
  seedRecord({
    id: "seen-shot-20260618-01",
    title: "薛之谦“万兽之王”巡回演唱会-洛阳站",
    artists: ["薛之谦"],
    category: "concert",
    status: "watched",
    recordState: "normal",
    date: "2026-06-14",
    time: "19:30",
    city: "洛阳",
    venue: "洛阳奥林匹克中心体育场",
    price: 912,
    seat: "",
    companions: [],
    sourceChannel: "damai",
    sourceUrl: "https://m.damai.cn/shows/item.html?itemId=1050747499269",
    importConfidence: 0.9,
    tags: ["巡演", "万兽之王", "海报已校准"],
    setlist: [],
    note: "海报和座位图来自大麦公开页，个人座位信息可继续补充。",
    colors: ["#171c1f", "#b8c6c2"],
    poster: xuePoster,
    seatMap: xueSeatMap,
  }),
  ...[
    ["seen-shot-20260618-02", "周深2025「深深的」巡回演唱会-福州站", "周深", "2025-10-19", "19:30", "福州", "福州海峡奥林匹克体育中心体育场", 929, "C2区 17排 8号", "seen-02.jpg", ["巡演", "深深的"]],
    ["seen-shot-20260618-03", "山歌响起的地方·刀郎2025巡回演唱会-乌鲁木齐站", "刀郎", "2025-10-04", "21:00", "乌鲁木齐", "乌鲁木齐奥体中心综合体育馆", 480, "西侧看台 B406区 8排 78号", "seen-03.jpg", ["巡演", "山歌响起的地方"]],
    ["seen-shot-20260618-04", "2025“潮流天后”超级演唱会-乌鲁木齐站", "张韶涵 / A-Lin黄丽玲 / Ella陈嘉桦 / 希林娜依·高", "2025-09-06", "21:00", "乌鲁木齐", "乌鲁木齐奥体中心体育场", 280, "三层看台 D214区 2排 14号", "seen-04.jpg", ["拼盘演唱会", "多艺人"]],
    ["seen-shot-20260618-05", "2025张杰未·LIVE—「开往1982」世界巡回演唱会-乌鲁木齐站", "张杰", "2025-08-17", "21:00", "乌鲁木齐", "乌鲁木齐奥体中心体育场", 680, "A202区 三层看台 11排1号", "seen-05.jpg", ["巡演", "开往1982"]],
    ["seen-shot-20260618-06", "刘若英「飞行日」2025巡回演唱会-乌鲁木齐站", "刘若英", "2025-08-09", "23:00", "乌鲁木齐", "乌鲁木齐奥体中心综合体育馆", 499, "四层看台 D402区 5排 59座", "seen-06.jpg", ["巡演", "飞行日4.0"]],
    ["seen-shot-20260618-07", "李健“万物安生时”巡回演唱会-乌鲁木齐站", "李健", "2024-09-16", "21:00", "乌鲁木齐", "乌鲁木齐奥体中心综合体育馆", 380, "C403区 14排 45号", "seen-07.jpg", ["巡演", "万物安生时"]],
    ["seen-shot-20260618-08", "汪苏泷2024「十万伏特」巡回演唱会-郑州站", "汪苏泷", "2024-08-18", "19:00", "郑州", "郑州奥林匹克体育中心体育场", 880, "内场 D1区 14排 20号", "seen-08.jpg", ["巡演", "十万伏特"]],
    ["seen-shot-20260618-09", "汪苏泷2024「十万伏特」巡回演唱会-郑州站", "汪苏泷", "2024-08-17", "19:00", "郑州", "郑州奥林匹克体育中心体育场", 580, "G2区 15排 13排 29座", "seen-09.jpg", ["巡演", "十万伏特"]],
    ["seen-shot-20260618-10", "2024华晨宇火星演唱会-合肥站", "华晨宇", "2024-08-10", "19:00", "合肥", "合肥体育中心体育场", 680, "一层看台 55排 54号", "seen-10.jpg", ["巡演", "火星演唱会"]],
    ["seen-shot-20260618-11", "五月天「回到那一天」25周年巡回演唱会-太原站", "五月天", "2024-08-02", "19:00", "太原", "山西体育中心体育场", 205, "144区 17排", "seen-11.jpg", ["巡演", "5525"]],
    ["seen-shot-20260618-12", "2024周深9.29Hz巡回演唱会-武汉站", "周深", "2024-07-27", "19:30", "武汉", "武汉体育中心主体育场", 929, "1层看台 C108区 15排13座", "seen-12.jpg", ["巡演", "9.29Hz"]],
    ["seen-shot-20260618-13", "薛之谦“天外来物”巡回演唱会-乌鲁木齐站", "薛之谦", "2024-05-19", "20:00", "乌鲁木齐", "乌鲁木齐奥体中心体育场", 717, "C13区 4排 2号", "seen-13.jpg", ["巡演", "天外来物"]],
    ["seen-shot-20260618-14", "赵雷“没有信号”2024巡演-西安站", "赵雷", "2024-03-10", "20:00", "西安", "西安奥体中心体育馆", 999, "内场 A3区 11排 25号", "seen-14.jpg", ["巡演", "没有信号"]],
  ].map(([id, title, artistText, date, time, city, venue, price, seat, posterName, tags]) =>
    seedRecord({
      id: String(id),
      title: String(title),
      artists: String(artistText).split(/\s*\/\s*/).filter(Boolean),
      category: "concert",
      status: "watched",
      recordState: "normal",
      date: String(date),
      time: String(time),
      city: String(city),
      venue: String(venue),
      price: Number(price),
      seat: String(seat),
      companions: [],
      sourceChannel: "damai",
      importConfidence: 0.74,
      tags: tags as string[],
      setlist: [],
      note: "由手机截图批量导入；可继续补充票根原图、座位图和现场精选照片。",
      colors: ["#101418", "#dfff4f"],
      poster: posterByName(String(posterName)),
    }),
  ),
  ...[
    ["festival-shot-20260618-01", "【乌鲁木齐】2025新疆超级草莓音乐节Day2", "陈粒 / 陈绮贞 / 新裤子 / 夏日入侵企画", "2025-07-13", 569, "festival-01.jpg", ["草莓音乐节", "Day2"]],
    ["festival-shot-20260618-02", "【乌鲁木齐】2025新疆超级草莓音乐节Day1", "赵雷 / 吴克群 / 阿肆 / 郑润泽", "2025-07-12", 569, "festival-02.jpg", ["草莓音乐节", "Day1"]],
    ["festival-shot-20260618-03", "【乌鲁木齐】2024新疆超级草莓音乐节Day3", "Bewilder / 陈婧霏 / DOUDOU", "2024-05-26", 298, "festival-03.jpg", ["草莓音乐节", "Day3"]],
    ["festival-shot-20260618-04", "【乌鲁木齐】2024新疆超级草莓音乐节Day2", "赵雷 / 旅行团 / 马頔 / 瓦依那", "2024-05-25", 298, "festival-04.jpg", ["草莓音乐节", "Day2"]],
    ["festival-shot-20260618-05", "【乌鲁木齐】2024新疆超级草莓音乐节Day1", "林宥嘉 / 回春丹 / PeaceHotel", "2024-05-24", 298, "festival-05.jpg", ["草莓音乐节", "Day1"]],
    ["festival-shot-20260618-06", "网易云音乐×65PARK·营地音乐节Day2", "新裤子 / 郭顶 / 棱镜 / 邵帅", "2023-09-03", 349, "festival-06.jpg", ["65PARK", "Day2"]],
    ["festival-shot-20260618-07", "网易云音乐×65PARK·营地音乐节Day1", "陆柯燃 / 房东的猫 / 凤凰传奇", "2023-09-02", 349, "festival-07.jpg", ["65PARK", "Day1"]],
    ["festival-shot-20260618-08", "【乌鲁木齐】长福宫·2023新疆草莓音乐节Day2", "痛仰 / 陈粒 / 马赛克 / 阿肆", "2023-05-28", 380, "festival-08b.jpg", ["草莓音乐节", "Day2"]],
    ["festival-shot-20260618-09", "【乌鲁木齐】长福宫·2023新疆草莓音乐节Day1", "万能青年旅店 / 张震岳 / 王以太", "2023-05-27", 380, "festival-09b.jpg", ["草莓音乐节", "Day1"]],
  ].map(([id, title, artistText, date, price, posterName, tags]) =>
    seedRecord({
      id: String(id),
      title: String(title),
      artists: String(artistText).split(/\s*\/\s*/).filter(Boolean),
      category: "festival",
      status: "watched",
      recordState: "normal",
      date: String(date),
      time: "15:30",
      city: "乌鲁木齐",
      venue: String(title).includes("65PARK") ? "乌鲁木齐九家湾营地" : "乌鲁木齐水磨沟区天山明月城",
      price: Number(price),
      seat: "音乐节通票",
      companions: [],
      sourceChannel: "damai",
      importConfidence: 0.72,
      tags: tags as string[],
      setlist: [],
      note: "音乐节记录按每日独立保存，支持多艺人阵容和现场照片墙。",
      colors: ["#101418", "#ff6b8a"],
      poster: posterByName(String(posterName)),
    }),
  ),
];
