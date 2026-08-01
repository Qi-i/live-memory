import assert from "node:assert/strict";

const expectedSha = "ce56c36954d0b914cd31cb0874353c508be412b5";
const siteUrl = "https://qi-i.github.io/live-memory/";
const token = process.env.GITHUB_TOKEN || "";
const apiHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "live-memory-deployment-verifier",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  "X-GitHub-Api-Version": "2022-11-28",
};

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": "live-memory-deployment-verifier",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

const response = await fetch(
  "https://api.github.com/repos/Qi-i/live-memory/actions/workflows/deploy.yml/runs?branch=main&event=push&per_page=30",
  { headers: apiHeaders },
);
if (!response.ok) throw new Error(`GitHub Actions API returned HTTP ${response.status}: ${await response.text()}`);
const payload = await response.json();
const recentRuns = payload.workflow_runs.slice(0, 8).map((run) => ({
  id: run.id,
  head_sha: run.head_sha,
  status: run.status,
  conclusion: run.conclusion,
  created_at: run.created_at,
  html_url: run.html_url,
}));
console.log("RECENT_PAGES_RUNS=" + JSON.stringify(recentRuns));

const deploymentRun = payload.workflow_runs.find((run) => run.head_sha === expectedSha);
assert.ok(deploymentRun, `No Deploy GitHub Pages run found for ${expectedSha}`);
assert.equal(deploymentRun.head_sha, expectedSha);
assert.equal(deploymentRun.conclusion, "success");
assert.equal(deploymentRun.head_branch, "main");

const cacheBust = Date.now();
const indexHtml = await fetchText(`${siteUrl}?deployment-check=${cacheBust}`);
const paths = Array.from(indexHtml.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g), (match) => match[1]);
const assetUrls = paths.map((path) => new URL(path, siteUrl).href);
console.log("LIVE_ASSET_URLS=" + JSON.stringify(assetUrls));
const assetContents = await Promise.all(assetUrls.map((url) => fetchText(`${url}?deployment-check=${cacheBust}`)));
const liveAssets = assetContents.join("\n");
const checks = {
  scopeTitle: liveAssets.includes("选择真正想分享的现场"),
  manualSelection: liveAssets.includes("逐场选择"),
  limit20: liveAssets.includes("20 张"),
  limit30: liveAssets.includes("30 张"),
  posterFrame: liveAssets.includes("share-poster-frame"),
  posterForeground: liveAssets.includes("share-poster-foreground"),
  bannerComposition: liveAssets.includes("archive-highlight-card-1"),
};
console.log("LIVE_FEATURE_CHECKS=" + JSON.stringify(checks));

assert.match(indexHtml, /<div id="root"><\/div>/);
for (const [name, passed] of Object.entries(checks)) assert.ok(passed, `Live feature check failed: ${name}`);

console.log(`DEPLOYMENT_VERIFIED_SHA=${expectedSha}`);
console.log(`DEPLOYMENT_WORKFLOW_RUN_ID=${deploymentRun.id}`);
console.log(`DEPLOYMENT_WORKFLOW_URL=${deploymentRun.html_url}`);
console.log(`LIVE_SITE_VERIFIED=${siteUrl}`);
