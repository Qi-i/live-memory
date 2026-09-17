# Map Poster Clusters and Personal Cloud Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore saved personal Supabase media automatically after login and redesign the AMap archive view around linked poster-stack place clusters and a synchronized ranking panel.

**Architecture:** Keep account/profile recovery in `supabase.ts` and orchestration/status in `appController.ts`; keep AMap script/API details in `amap.ts`; keep archive grouping/selection/picker UI in `archive.tsx` and styling in `archive.css`. Add narrow regression scripts first, then production code, then browser visual coverage.

**Tech Stack:** React, TypeScript, Supabase JS, AMap JS API 2.0, Node contract tests, Playwright visual audit, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-map-poster-clusters-cloud-reconnect-design.md`

## Global Constraints

- No database schema migration.
- No public/shared personal Supabase credentials.
- Do not delete or overwrite backup data when reconnect fails.
- First map-place click opens a place picker; only a poster selection opens record detail.
- City and venue modes use the same grouping/heat/selection model.
- Map and ranking use the same normalized heat value.

---

### Task 1: Personal Cloud Reconnect Contracts

**Files:**
- Create: `scripts/personal-cloud-reconnect-tests.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `syncAfterLogin`, `signInStorageWithAccount`, `refreshSignedMediaUrls`, controller focus/online recovery effects.
- Produces: regression contract that forbids one-shot silent reconnect failure.

- [ ] **Step 1: Write the failing contract test**

Assert that `syncAfterLogin` exposes reconnect success/failure state, that the controller has a personal-cloud recovery action/effect, that successful reconnect triggers signed media refresh, and that focus/online paths retry a failed reconnect.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node scripts/personal-cloud-reconnect-tests.mjs`

Expected: FAIL because the current implementation silently catches the single reconnect attempt.

- [ ] **Step 3: Add the test to `npm test` / `npm run check`**

Keep existing scripts intact and append the new test.

- [ ] **Step 4: Commit the RED test**

Commit message: `test: capture personal cloud reconnect regression`

---

### Task 2: Implement Bounded Personal Cloud Recovery

**Files:**
- Modify: `src/supabase.ts`
- Modify: `src/appController.ts`
- Modify: `src/AppRoot.tsx`

**Interfaces:**
- Produces: explicit personal-cloud recovery state and `recoverPersonalCloud()` controller action.
- `syncAfterLogin()` returns enough information to distinguish `connected`, `reconnect-needed`, and media-refresh outcome without discarding text records.

- [ ] **Step 1: Extend post-login sync result**

Add explicit personal-cloud recovery status to `PostLoginSyncResult`, keeping text-record recovery independent from personal-cloud failure.

- [ ] **Step 2: Refresh signed media immediately after successful reconnect**

After deriving the owner key, sign media URLs against the restored records before returning the post-login result.

- [ ] **Step 3: Add controller retry orchestration**

Add a bounded reconnect function with short backoff and re-entry guards. Retry on initial login, `focus`, and `online` only while reconnect is needed.

- [ ] **Step 4: Expose truthful UI status**

Update the global cloud center copy/status so “当前已是最新” applies to text sync only when media recovery is also ready; otherwise surface “个人云端需恢复/正在恢复”.

- [ ] **Step 5: Run reconnect contracts and full check**

Run: `node scripts/personal-cloud-reconnect-tests.mjs`
Run: `npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `fix: recover personal cloud media after login`

---

### Task 3: Map Aggregation and Interaction Contracts

**Files:**
- Create: `scripts/archive-map-cluster-tests.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: source/behavior contracts for grouped poster markers, heat scale, shared selection, and two-stage record opening.

- [ ] **Step 1: Write failing map contracts**

Assert source contains a place-group builder, normalized heat, custom marker `content`, selected place state, place picker UI, ranking hover/click linkage, and that map-marker click does not directly call `onOpen(record)`.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `node scripts/archive-map-cluster-tests.mjs`

Expected: FAIL because the current implementation creates ordinary `AMap.Marker({ position, title })` pins and opens the first record directly.

- [ ] **Step 3: Add to the standard check chain**

Append without removing existing tests.

- [ ] **Step 4: Commit RED test**

Commit message: `test: define poster cluster map interactions`

---

### Task 4: Implement Poster Place Groups and AMap Marker API

**Files:**
- Modify: `src/amap.ts`
- Modify: `src/archive.tsx`

**Interfaces:**
- `buildPlaceGroups(records, mode)` produces `{ key, label, count, heat, point, records }[]`.
- AMap wrapper types support marker custom `content`, click/mouse events, marker positioning, map click, and map focus/zoom calls used by archive UI.

- [ ] **Step 1: Build deterministic place groups**

Group city/venue records once, sort records by date, choose representative coordinates from explicit record coordinates then city fallback, and compute `heat = count / maxCount`.

- [ ] **Step 2: Replace generic pins with poster-stack custom markers**

Create HTML marker content with up to three poster thumbnail layers, count badge, and heat CSS custom property/data attributes.

- [ ] **Step 3: Implement selected/hovered place state**

Marker click sets `selectedPlaceKey` and opens the picker. Marker hover updates shared hover state. Map background click clears selection.

- [ ] **Step 4: Implement floating place picker**

Render one large card for a single record and a compact poster grid for multiple records. Poster/card click alone calls existing `onOpen(record)`.

- [ ] **Step 5: Implement ranking linkage**

Ranking rows share selection/hover state. Hover highlights marker; click selects place, focuses/zooms the map, and opens the picker. Marker selection highlights and scrolls matching ranking row.

- [ ] **Step 6: Run focused contracts**

Run: `node scripts/archive-map-cluster-tests.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: add poster cluster archive map`

---

### Task 5: Map Visual System

**Files:**
- Modify: `src/archive.css`

**Interfaces:**
- Consumes: `.amap-poster-marker`, heat custom property, selected/hovered classes, `.venue-place-picker`, ranking heat variables.
- Produces: one visual language shared by map and ranking.

- [ ] **Step 1: Style poster-stack markers**

Use compact overlapping poster cards with a readable count badge, selected ring, and heat-driven scale/accent. Avoid giant markers that obscure the map.

- [ ] **Step 2: Add shared heat scale**

Use a cool→warm or low-saturation→high-emphasis gradient for marker base/ring and ranking bar, with accessible contrast.

- [ ] **Step 3: Style picker and legend**

Picker should float above map content, remain readable over tiles, and support 1–many poster layouts. Add a minimal low→high legend.

- [ ] **Step 4: Keep responsive behavior**

On narrower screens, keep map usable and allow picker/ranking to stack without viewport overflow.

- [ ] **Step 5: Run full check**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `style: link map heat and poster picker visuals`

---

### Task 6: Browser Visual Regression

**Files:**
- Modify: existing Playwright visual audit script(s) under `scripts/`

**Interfaces:**
- Produces: screenshots/assertions for poster cluster markers, selected picker, ranking linkage, legend, and cloud-reconnect status.

- [ ] **Step 1: Extend visual fixture**

Create several records in one city and single records in other cities with representative posters so heat and stacking are visually testable.

- [ ] **Step 2: Add map assertions**

Assert custom marker count, selected marker/picker after first click, record detail only after poster click, ranking selection linkage, and legend visibility.

- [ ] **Step 3: Add cloud recovery UI assertion**

Stub reconnect-needed state and confirm the global cloud center surfaces it instead of reporting everything current.

- [ ] **Step 4: Run CI-equivalent visual workflow**

Run the repository’s existing build/preview/Playwright visual command.

Expected: PASS with screenshots free of overlap/cutoff.

- [ ] **Step 5: Commit**

Commit message: `test: cover map clusters and cloud recovery visually`

---

### Task 7: Final Verification and Integration

**Files:**
- No production changes unless verification finds a defect.

- [ ] **Step 1: Run `npm run check` fresh**

Expected: zero failures.

- [ ] **Step 2: Run formal PR `verify + visual`**

Expected: both jobs success on the final user-authored head SHA.

- [ ] **Step 3: Inspect actual browser artifacts**

Verify map heat is legible, poster clusters do not hide geography, picker is usable, ranking visibly corresponds to map, and cloud status is truthful.

- [ ] **Step 4: Squash merge only after green**

- [ ] **Step 5: Verify GitHub Pages deployment**

Require Build application, Deploy to GitHub Pages, and Verify live deployment SHA to all succeed for the merge commit.