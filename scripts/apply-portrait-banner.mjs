import { readFile, writeFile } from "node:fs/promises";

const path = "src/archive.css";
let source = await readFile(path, "utf8");

function replace(pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Could not find ${label}`);
  source = source.replace(pattern, replacement);
}

replace(
  /\.archive-masthead \{[\s\S]*?\n\}/,
  `.archive-masthead {
  position: relative;
  display: grid;
  grid-template-columns: minmax(360px, 0.92fr) minmax(500px, 1.08fr);
  min-height: 430px;
  overflow: hidden;
  isolation: isolate;
  background:
    radial-gradient(circle at 78% 12%, color-mix(in srgb, var(--experience-accent) 28%, transparent), transparent 25%),
    radial-gradient(circle at 57% 88%, color-mix(in srgb, var(--experience-accent-2) 18%, transparent), transparent 31%),
    linear-gradient(135deg, color-mix(in srgb, var(--experience-accent) 10%, var(--experience-surface-solid)), var(--experience-surface-solid) 47%, color-mix(in srgb, var(--experience-accent-2) 10%, var(--experience-surface-solid)));
}`,
  "archive masthead",
);

replace(
  /\.archive-highlights \{[\s\S]*?\.archive-highlight-empty small \{[^\n]*\}\n/,
  `.archive-highlights {
  position: relative;
  z-index: 2;
  min-height: 430px;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--experience-accent) 25%, transparent), transparent 34%),
    linear-gradient(150deg, color-mix(in srgb, var(--experience-surface-solid) 10%, transparent), color-mix(in srgb, var(--experience-accent-2) 8%, transparent));
}

.archive-highlights::after {
  content: "";
  position: absolute;
  right: 8%;
  bottom: 5%;
  left: 8%;
  height: 52px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--experience-text) 17%, transparent);
  filter: blur(28px);
  transform: perspective(420px) rotateX(72deg);
  pointer-events: none;
}

.archive-highlight-orbit {
  position: absolute;
  top: 12%;
  left: 30%;
  width: 44%;
  aspect-ratio: 1;
  border: 1px solid color-mix(in srgb, var(--experience-accent) 46%, transparent);
  border-radius: 50%;
  box-shadow: 0 0 0 38px color-mix(in srgb, var(--experience-accent) 7%, transparent), 0 0 0 78px color-mix(in srgb, var(--experience-accent-2) 4%, transparent);
  opacity: 0.72;
}

.archive-highlight-stack {
  position: absolute;
  inset: 18px 20px 22px 12px;
  perspective: 1200px;
}

.archive-highlight-card {
  position: absolute;
  z-index: 1;
  width: auto;
  height: 68%;
  aspect-ratio: 2 / 3;
  padding: 0;
  overflow: hidden;
  border: 4px solid color-mix(in srgb, var(--experience-surface-solid) 92%, white);
  border-radius: 15px;
  color: white;
  background: color-mix(in srgb, var(--experience-surface-solid) 84%, #101a18);
  box-shadow: 0 24px 58px rgba(25, 46, 44, 0.25);
  cursor: pointer;
  transform-origin: 50% 100%;
  transition: transform 180ms ease, filter 180ms ease, box-shadow 180ms ease;
}

.archive-highlight-card:hover {
  z-index: 9;
  filter: saturate(1.05);
  box-shadow: 0 32px 72px rgba(25, 46, 44, 0.33);
}

.archive-highlight-card-1 { top: 2%; left: 38%; z-index: 6; height: 88%; transform: rotate(-1deg) translateZ(78px); }
.archive-highlight-card-2 { top: 16%; left: 13%; z-index: 3; height: 69%; transform: rotate(-8deg) translateZ(18px); }
.archive-highlight-card-3 { top: 15%; right: 9%; z-index: 4; height: 72%; transform: rotate(7deg) translateZ(28px); }
.archive-highlight-card-4 { top: 27%; left: 1%; z-index: 2; height: 56%; transform: rotate(-12deg); }
.archive-highlight-card-5,
.archive-highlight-card-6 { display: none; }
.archive-highlight-card-1:hover { transform: rotate(-1deg) translateY(-8px) translateZ(96px); }
.archive-highlight-card-2:hover { transform: rotate(-5deg) translateY(-7px) translateZ(52px); }
.archive-highlight-card-3:hover { transform: rotate(5deg) translateY(-7px) translateZ(54px); }
.archive-highlight-card-4:hover { transform: rotate(-6deg) translateY(-7px) translateZ(45px); }

.archive-highlight-card img,
.archive-highlight-card > .record-media-fallback {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: color-mix(in srgb, var(--experience-surface-solid) 84%, #101a18);
}

.archive-highlight-card > span:last-child {
  position: absolute;
  right: 8px;
  bottom: 8px;
  left: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
  padding: 7px 9px;
  border-radius: 9px;
  color: #111318;
  background: color-mix(in srgb, var(--experience-accent) 93%, white);
  box-shadow: 0 7px 18px rgba(0, 0, 0, 0.16);
}

.archive-highlight-card > span b {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-highlight-card > span small { font-size: 8px; font-weight: 900; }

.archive-highlight-feature {
  position: absolute;
  right: 20px;
  bottom: 18px;
  z-index: 10;
  display: grid;
  max-width: 260px;
  gap: 3px;
  padding: 11px 13px;
  border: 1px solid color-mix(in srgb, var(--experience-border) 80%, transparent);
  border-radius: 13px;
  color: var(--experience-text);
  text-align: left;
  background: color-mix(in srgb, var(--experience-surface-solid) 76%, transparent);
  box-shadow: 0 12px 34px color-mix(in srgb, var(--experience-text) 12%, transparent);
  backdrop-filter: blur(18px);
  cursor: pointer;
}

.archive-highlight-feature span { color: #108879; font-size: 9px; font-weight: 950; letter-spacing: 0.12em; }
.archive-highlight-feature strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.archive-highlight-feature small { overflow: hidden; color: var(--experience-muted); font-size: 9px; font-weight: 780; text-overflow: ellipsis; white-space: nowrap; }

.archive-highlight-empty {
  display: grid;
  min-height: 430px;
  place-items: center;
  align-content: center;
  gap: 6px;
  padding: 24px;
  color: var(--experience-text);
  text-align: center;
  background: radial-gradient(circle, color-mix(in srgb, var(--experience-accent) 22%, transparent), transparent 56%);
}

.archive-highlight-empty span { font-size: 18px; font-weight: 950; }
.archive-highlight-empty small { color: var(--experience-muted); font-weight: 780; }
`,
  "archive highlight block",
);

replace(
  /\.archive-highlights \{ min-height: 330px; border-top: 1px solid var\(--experience-border\); \}\n  \.archive-highlight-stack \{ inset: 10px 8px 18px; \}\n  \.archive-highlight-card-1 \{ left: 35%; width: 30%; \}\n  \.archive-highlight-feature \{ right: 16px; bottom: 14px; \}/,
  `.archive-highlights { min-height: 360px; border-top: 1px solid var(--experience-border); }
  .archive-highlight-stack { inset: 12px 10px 18px; }
  .archive-highlight-card-1 { left: 40%; height: 88%; }
  .archive-highlight-card-2 { left: 16%; }
  .archive-highlight-card-3 { right: 13%; }
  .archive-highlight-feature { right: 16px; bottom: 14px; }`,
  "tablet banner rules",
);

replace(
  /  \.archive-highlights \{ min-height: 245px; \}[\s\S]*?  \.archive-highlight-card > span b \{ font-size: 9px; \}/,
  `  .archive-highlights { min-height: 265px; }
  .archive-highlight-stack { inset: 8px 6px 14px; }
  .archive-highlight-card { border-width: 3px; border-radius: 11px; }
  .archive-highlight-card-1 { top: 3%; left: 37%; height: 86%; }
  .archive-highlight-card-2 { top: 18%; left: 8%; height: 66%; }
  .archive-highlight-card-3 { top: 17%; right: 5%; height: 67%; }
  .archive-highlight-card-4 { top: 30%; left: -3%; height: 50%; }
  .archive-highlight-card-5,
  .archive-highlight-card-6,
  .archive-highlight-feature { display: none; }
  .archive-highlight-card > span:last-child { right: 5px; bottom: 5px; left: 5px; padding: 5px 7px; }
  .archive-highlight-card > span b { font-size: 8px; }`,
  "mobile banner rules",
);

if (!source.includes("object-fit: contain")) throw new Error("Portrait image containment was not applied");
await writeFile(path, source);
console.log("Portrait banner migration applied.");
