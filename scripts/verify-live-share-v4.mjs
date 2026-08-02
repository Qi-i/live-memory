import assert from "node:assert/strict";

const expectedSha = "67ff8a727289044a2cf278fde01da9c0d9fa869f";
const siteUrl = "https://qi-i.github.io/live-memory/";
const token = process.env.GITHUB_TOKEN || "";
const apiHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getJson(url) {
  const response = await fetch(url, { headers: apiHeaders, cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function getText(url) {
  const separator = url.includes("?") ? "&" : "?";
  const response = await fetch(`${url}${separator}verify=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function absoluteAssetUrl(value) {
  return new URL(value, siteUrl).href;
}

let verifiedRun = null;
let featureChecks = null;
let assetUrls = [];

for (let attempt = 1; attempt <= 36; attempt += 1) {
  const runs = await getJson("https://api.github.com/repos/Qi-i/live-memory/actions/workflows/deploy.yml/runs?per_page=12");
  const recent = runs.workflow_runs.map((run) => ({
    id: run.id,
    head_sha: run.head_sha,
    status: run.status,
    conclusion: run.conclusion,
    created_at: run.created_at,
    html_url: run.html_url,
  }));
  console.log(`ATTEMPT_${attempt}_PAGES_RUNS=${JSON.stringify(recent)}`);
  verifiedRun = recent.find((run) => run.head_sha === expectedSha && run.status === "completed" && run.conclusion === "success") || null;

  if (verifiedRun) {
    const html = await getText(siteUrl);
    const matches = Array.from(html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g), (match) => absoluteAssetUrl(match[1]));
    assetUrls = Array.from(new Set(matches));
    const assets = await Promise.all(assetUrls.map((url) => getText(url)));
    const joined = assets.join("\n");
    const compact = joined.replace(/\s+/g, "");
    featureChecks = {
      categoryFilter: joined.includes("演出类型") && joined.includes("音乐节") && joined.includes("Livehouse"),
      newestFirst: joined.includes("最新在前") && joined.includes("date-desc"),
      wallLayout: joined.includes("密集海报墙") && compact.includes("share-preview-wall"),
      timelineLayout: joined.includes("时间长卷") && compact.includes("share-preview-timeline"),
      magazineLayout: joined.includes("编目杂志") && compact.includes("share-preview-magazine"),
      cityLayout: joined.includes("城市路线") && compact.includes("share-preview-cities"),
      posterRatio: compact.includes("aspect-ratio:4/5") && compact.includes("object-fit:cover"),
      branding: joined.includes("现场记") && joined.includes("Live Memory") && compact.includes("brand-lockup"),
    };
    console.log(`LIVE_ASSET_URLS=${JSON.stringify(assetUrls)}`);
    console.log(`LIVE_FEATURE_CHECKS=${JSON.stringify(featureChecks)}`);
    if (Object.values(featureChecks).every(Boolean)) break;
  }

  if (attempt < 36) await sleep(10000);
}

assert.ok(verifiedRun, `No successful Pages deployment found for ${expectedSha}`);
assert.ok(assetUrls.length >= 2, `Live site did not expose JS/CSS assets: ${JSON.stringify(assetUrls)}`);
for (const [name, passed] of Object.entries(featureChecks || {})) {
  assert.ok(passed, `Live feature check failed: ${name}`);
}

console.log(`DEPLOYMENT_VERIFIED_SHA=${expectedSha}`);
console.log(`DEPLOYMENT_WORKFLOW_RUN_ID=${verifiedRun.id}`);
console.log(`DEPLOYMENT_WORKFLOW_URL=${verifiedRun.html_url}`);
console.log(`LIVE_SITE_VERIFIED=${siteUrl}`);
