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
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

let deploymentRun;
for (let attempt = 1; attempt <= 40; attempt += 1) {
  const response = await fetch(
    "https://api.github.com/repos/Qi-i/live-memory/actions/workflows/deploy.yml/runs?branch=main&event=push&per_page=30",
    { headers: apiHeaders },
  );
  if (!response.ok) throw new Error(`GitHub Actions API returned HTTP ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  deploymentRun = payload.workflow_runs.find((run) => run.head_sha === expectedSha);
  if (deploymentRun?.conclusion === "success") break;
  if (deploymentRun?.status === "completed" && deploymentRun.conclusion !== "success") {
    throw new Error(`Pages deployment run ${deploymentRun.id} concluded ${deploymentRun.conclusion}`);
  }
  console.log(`Waiting for Pages workflow for ${expectedSha.slice(0, 12)} (attempt ${attempt}/40)`);
  await sleep(15_000);
}

assert.ok(deploymentRun, `No Deploy GitHub Pages run found for ${expectedSha}`);
assert.equal(deploymentRun.head_sha, expectedSha);
assert.equal(deploymentRun.conclusion, "success");
assert.equal(deploymentRun.head_branch, "main");

let liveAssets = "";
let indexHtml = "";
for (let attempt = 1; attempt <= 30; attempt += 1) {
  const cacheBust = `${Date.now()}-${attempt}`;
  indexHtml = await fetchText(`${siteUrl}?deployment-check=${cacheBust}`);
  const paths = Array.from(indexHtml.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g), (match) => match[1]);
  const assetUrls = paths.map((path) => new URL(path, siteUrl).href);
  const assetContents = await Promise.all(assetUrls.map((url) => fetchText(`${url}?deployment-check=${cacheBust}`)));
  liveAssets = assetContents.join("\n");
  const hasSelection = liveAssets.includes("选择真正想分享的现场") && liveAssets.includes("逐场选择");
  const hasMassShare = liveAssets.includes("20 张") && liveAssets.includes("30 张");
  const hasPortraitFrame = liveAssets.includes("share-poster-frame") && liveAssets.includes("share-poster-foreground");
  const hasBanner = liveAssets.includes("archive-highlight-card-1");
  if (hasSelection && hasMassShare && hasPortraitFrame && hasBanner) break;
  console.log(`Pages is reachable but still serving an older asset set (attempt ${attempt}/30)`);
  await sleep(10_000);
}

assert.match(indexHtml, /<div id="root"><\/div>/);
assert.ok(liveAssets.includes("选择真正想分享的现场"), "Live JS does not contain the new scope selector");
assert.ok(liveAssets.includes("逐场选择"), "Live JS does not contain manual record selection");
assert.ok(liveAssets.includes("20 张") && liveAssets.includes("30 张"), "Live JS does not contain mass poster limits");
assert.ok(liveAssets.includes("share-poster-frame"), "Live CSS does not contain portrait poster frames");
assert.ok(liveAssets.includes("share-poster-foreground"), "Live CSS does not preserve the full foreground poster");
assert.ok(liveAssets.includes("archive-highlight-card-1"), "Live CSS does not contain the portrait Banner composition");

console.log(`DEPLOYMENT_VERIFIED_SHA=${expectedSha}`);
console.log(`DEPLOYMENT_WORKFLOW_RUN_ID=${deploymentRun.id}`);
console.log(`DEPLOYMENT_WORKFLOW_URL=${deploymentRun.html_url}`);
console.log(`LIVE_SITE_VERIFIED=${siteUrl}`);
