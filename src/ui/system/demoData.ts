/** Public demonstration fixtures; never read a personal account or database. */
export interface DemoShow {
  id: string;
  title: string;
  artist: string;
  city: string;
  venue: string;
  date: string;
  status: "已看" | "待看";
  src?: string;
}

const asset = (file: string) => import.meta.env.BASE_URL + "demo/" + file;

export const demoShows: DemoShow[] = [
  { id: "demo-zhou", title: "周深 · 深深的巡回演唱会", artist: "周深", city: "郑州",
    venue: "郑州奥林匹克体育中心", date: "2026-06-28", status: "已看", src: asset("zhou-shen.webp") },
  { id: "demo-xue", title: "薛之谦 · 万兽之王", artist: "薛之谦", city: "洛阳",
    venue: "洛阳奥林匹克中心体育场", date: "2026-06-14", status: "已看", src: asset("xue-zhiqian.webp") },
  { id: "demo-zhang", title: "张杰 · 未LIVE", artist: "张杰", city: "乌鲁木齐",
    venue: "乌鲁木齐奥体中心", date: "2025-08-17", status: "已看", src: asset("zhang-jie.jpg") },
  { id: "demo-wang", title: "汪苏泷 · 十万伏特", artist: "汪苏泷", city: "郑州",
    venue: "郑州奥林匹克中心", date: "2024-08-18", status: "已看", src: asset("wang-sulong.jpg") },
  { id: "demo-zhao", title: "赵雷 · 没有信号", artist: "赵雷", city: "西安",
    venue: "西安奥体中心", date: "2024-03-10", status: "已看", src: asset("zhao-lei.png") },
  { id: "demo-beijing", title: "北京现场 · 纪念音乐会", artist: "演示艺人", city: "北京",
    venue: "北京演出场馆（演示）", date: "2025-11-01", status: "已看" },
  { id: "demo-urumqi", title: "乌鲁木齐 · 城市音乐节", artist: "演示乐队", city: "乌鲁木齐",
    venue: "乌鲁木齐音乐广场（演示）", date: "2026-09-12", status: "待看" },
];

export const demoPosters = demoShows.map(({ id, title, city, src }) => ({ id, title, city, src }));
