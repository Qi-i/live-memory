import type { DemoShow } from "./demoData";

/** The preview export never reads account data or calls an external service. */
async function loadImage(source: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function fitText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) return value;
  let text = value;
  while (text.length > 1 && context.measureText(text + "…").width > maxWidth) {
    text = text.slice(0, -1);
  }
  return text + "…";
}

function rounded(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath();
  context.roundRect(x, y, w, h, r);
}

/**
 * Deterministic 4:5 review card generated from the currently visible
 * in-memory preview data. Poster art stays contained in portrait slots.
 */
export async function renderDemoRecap(shows: DemoShow[]): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持图片绘制");
  const ground = context.createLinearGradient(0, 0, 1080, 1350);
  ground.addColorStop(0, "#191b40");
  ground.addColorStop(.54, "#263764");
  ground.addColorStop(1, "#183c4d");
  context.fillStyle = ground;
  context.fillRect(0, 0, 1080, 1350);

  context.save();
  context.filter = "blur(110px)";
  context.fillStyle = "#7c65c6";
  context.beginPath(); context.arc(125, 200, 250, 0, Math.PI * 2); context.fill();
  context.fillStyle = "#4aa8c3";
  context.beginPath(); context.arc(910, 820, 330, 0, Math.PI * 2); context.fill();
  context.restore();

  rounded(context, 58, 58, 964, 1234, 44);
  context.fillStyle = "rgba(248,251,255,.09)";
  context.fill();
  context.strokeStyle = "rgba(255,255,255,.31)";
  context.lineWidth = 2; context.stroke();

  context.fillStyle = "#b8dfe6";
  context.font = "700 23px 'PingFang SC',sans-serif";
  context.fillText("LIVE MEMORY   /   MY LIVE STORY", 110, 150);
  context.fillStyle = "#fff";
  context.font = "bold 65px 'PingFang SC',sans-serif";
  context.fillText("把现场，留在时间里", 104, 246);
  context.fillStyle = "rgba(244,248,255,.81)";
  context.font = "29px 'PingFang SC',sans-serif";
  context.fillText("每一次现场，都值得珍藏。", 110, 302);

  const attended = shows.filter(show => show.status === "已看");
  const cities = new Set(attended.map(show => show.city).filter(Boolean));
  const artists = new Set(attended.map(show => show.artist).filter(Boolean));
  const metrics = [
    [String(shows.length).padStart(2, "0"), "演示记录"],
    [String(attended.length).padStart(2, "0"), "已经看过"],
    [String(cities.size).padStart(2, "0"), "到访城市"],
    [String(artists.size).padStart(2, "0"), "现场艺人"],
  ];
  metrics.forEach(([value, label], index) => {
    const x = 109 + index * 234;
    context.fillStyle = "rgba(255,255,255,.075)";
    rounded(context, x, 367, 210, 128, 22); context.fill();
    context.fillStyle = "#ffffff";
    context.font = "bold 48px 'PingFang SC',sans-serif";
    context.fillText(value, x + 22, 427);
    context.fillStyle = "#c9d3ea";
    context.font = "22px 'PingFang SC',sans-serif";
    context.fillText(label, x + 23, 468);
  });

  context.fillStyle = "#c9d8eb";
  context.font = "bold 24px 'PingFang SC',sans-serif";
  context.fillText("HIGHLIGHT MOMENTS", 108, 568);

  const artwork = shows.filter(s => s.src).slice(0, 3);
  for (let index = 0; index < 3; index++) {
    const show = artwork[index];
    const x = 110 + index * 291;
    const y = 599;
    rounded(context, x, y, 270, 412, 22);
    context.fillStyle = "rgba(246,247,255,.20)";
    context.fill();
    if (show?.src) {
      const image = await loadImage(show.src);
      if (image) {
        const availableW = 248, availableH = 358;
        const scale = Math.min(availableW / image.naturalWidth, availableH / image.naturalHeight);
        const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
        context.drawImage(image, x + 11 + (availableW - w)/2, y + 12 + (availableH - h)/2, w, h);
      }
    }
    context.fillStyle = "#fff";
    context.font = "bold 18px 'PingFang SC',sans-serif";
    context.fillText(fitText(context, show?.title || "现场记忆", 238), x + 16, y + 397);
  }

  context.fillStyle = "#dfe8f7";
  context.font = "bold 24px 'PingFang SC',sans-serif";
  context.fillText("我走过的现场", 110, 1100);
  context.fillStyle = "#b6d4e4";
  context.font = "24px 'PingFang SC',sans-serif";
  const cityText = [...cities].slice(0, 6).join("  ·  ") || "下一场精彩，仍在路上";
  context.fillText(fitText(context, cityText, 845), 110, 1144);

  context.fillStyle = "rgba(231,238,249,.72)";
  context.font = "21px 'PingFang SC',sans-serif";
  context.fillText("PRIVATE BY DESIGN    ·    DEMO ONLY", 110, 1248);
  return canvas.toDataURL("image/png");
}

export function saveDemoPng(source: string) {
  const anchor = document.createElement("a");
  anchor.href = source;
  anchor.download = "LiveMemory-V3-demo-recap.png";
  anchor.click();
}
