/** Public demo-only fixtures. No app domain, auth, storage or network module. */
export const demoPosters = [
  { id: "demo-zhou", title: "周深 · 深深的巡回演唱会", city: "郑州", file: "zhou-shen.webp" },
  { id: "demo-xue", title: "薛之谦 · 万兽之王", city: "洛阳", file: "xue-zhiqian.webp" },
  { id: "demo-zhang", title: "张杰 · 未LIVE", city: "乌鲁木齐", file: "zhang-jie.jpg" },
  { id: "demo-wang", title: "汪苏泷 · 十万伏特", city: "郑州", file: "wang-sulong.jpg" },
  { id: "demo-zhao", title: "赵雷 · 没有信号", city: "西安", file: "zhao-lei.png" },
].map(({ file, ...item }) => ({
  ...item,
  src: import.meta.env.BASE_URL + "demo/" + file,
}));
