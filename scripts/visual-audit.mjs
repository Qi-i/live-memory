import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.VISUAL_AUDIT_URL || "http://127.0.0.1:4173/";
const outputDir = "visual-artifacts";
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("console", (message) => { if (message.type() === "error") console.error(`[browser] ${message.text()}`); });
page.on("pageerror", (error) => console.error(`[pageerror] ${error.message}`));

function svgPoster(title, a, b) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="900" height="1200" fill="url(#g)"/><circle cx="690" cy="240" r="170" fill="rgba(255,255,255,.18)"/><path d="M0 850L900 520V1200H0Z" fill="rgba(0,0,0,.24)"/><text x="70" y="120" fill="white" font-family="Arial" font-size="38" font-weight="800">LIVE MEMORY</text><text x="70" y="620" fill="white" font-family="Arial" font-size="86" font-weight="900">${title}</text><text x="70" y="1020" fill="white" font-family="Arial" font-size="32" font-weight="700">CONCERT ARCHIVE</text></svg>`);
}

async function addRecord({ title, artist, city, venue, date, price, colors }) {
  await page.getByRole("button", { name: "新增", exact: true }).click();
  const editor = page.locator(".record-editor-v2");
  await editor.waitFor({ state: "visible" });
  await editor.getByLabel("演出名称").fill(title);
  await editor.getByLabel("艺人 / 阵容").fill(artist);
  await editor.getByLabel("日期").fill(date);
  await editor.getByLabel("城市").fill(city);
  await editor.getByLabel("场馆").fill(venue);
  await editor.getByLabel("票价").fill(String(price));
  await editor.locator(".media-upload-grid-v2 label").first().locator("input[type=file]").setInputFiles({
    name: `${title}.svg`,
    mimeType: "image/svg+xml",
    buffer: svgPoster(title, colors[0], colors[1]),
  });
  await editor.getByRole("button", { name: "保存记录", exact: true }).click();
  await page.locator(".record-detail-v2").waitFor({ state: "visible" });
  await page.locator(".record-detail-v2 .overlay-header-v2 > button").first().click();
}

try {
  const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`Preview returned ${response?.status() || "no response"}`);
  await page.locator(".access-shell").waitFor({ state: "visible", timeout: 15000 });
  await page.screenshot({ path: `${outputDir}/01-login-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "临时进入", exact: true }).click();
  await page.locator(".experience-shell").waitFor({ state: "visible", timeout: 15000 });

  const fixtures = [
    { title: "星河巡演", artist: "示例歌手 A", city: "上海", venue: "梅赛德斯奔驰文化中心", date: "2026-06-18", price: 680, colors: ["#21174f", "#7e5cff"] },
    { title: "夏日电波", artist: "示例乐队 B", city: "成都", venue: "露天音乐公园", date: "2026-08-08", price: 399, colors: ["#ff6b8a", "#dfff4f"] },
    { title: "午夜回声", artist: "独立乐队 C", city: "杭州", venue: "Livehouse", date: "2026-10-24", price: 220, colors: ["#0d5668", "#51d5c2"] },
    { title: "光影剧场", artist: "音乐剧团 D", city: "北京", venue: "国家大剧院", date: "2025-12-20", price: 880, colors: ["#8c2d42", "#f0b85a"] },
    { title: "山海现场", artist: "示例歌手 E", city: "重庆", venue: "华熙文化体育中心", date: "2025-09-12", price: 520, colors: ["#19392d", "#7ed36e"] },
    { title: "蓝色时刻", artist: "电子音乐人 F", city: "深圳", venue: "春茧体育馆", date: "2024-11-02", price: 480, colors: ["#122b58", "#5db9ff"] },
  ];
  for (const fixture of fixtures) await addRecord(fixture);

  await page.screenshot({ path: `${outputDir}/02-archive-poster-desktop.png`, fullPage: true });
  await page.getByTitle("画报").click();
  await page.screenshot({ path: `${outputDir}/03-archive-showcase-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "分享画布", exact: true }).click();
  await page.locator(".share-canvas").waitFor({ state: "visible" });
  await page.screenshot({ path: `${outputDir}/04-share-landscape.png`, fullPage: true });
  await page.getByRole("button", { name: "退出分享", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTitle("海报").click();
  await page.screenshot({ path: `${outputDir}/05-archive-mobile.png`, fullPage: true });
  await page.locator(".experience-mobile-nav").getByRole("button", { name: "设置", exact: true }).click();
  await page.screenshot({ path: `${outputDir}/06-guest-settings-mobile.png`, fullPage: true });
} finally {
  await browser.close();
}
