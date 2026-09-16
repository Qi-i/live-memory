# Share, Ticket, Sync, and Map Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sharing default to all records, add ticket aggregation, unify frosted poster-derived ticket visuals, tighten showcase layout, expose cloud recovery/refresh globally, and make AMap provider changes actually render AMap.

**Architecture:** Keep the current React/Vite data model intact. Add focused helpers/components for ticket visual styling and AMap loading; expose explicit sync commands from `useAppController`; keep canvas export logic parallel to DOM preview logic. All behavior changes are test-first and verified in Playwright.

**Tech Stack:** React, TypeScript, Vite, Canvas 2D, Supabase JS, AMap JS API 2.0, Playwright-style visual audit scripts.

**Spec:** `docs/superpowers/specs/2026-09-16-share-ticket-sync-map-redesign.md`

## Global Constraints

- Do not hard-code a personal AMap key or security code into the public repository.
- Do not change the persisted `EventRecord` schema.
- Keep existing automatic login sync and signed-media refresh behavior.
- Preview and PNG export for ticket aggregation must use the same record selection and layout semantics.
- `none`, `amap`, and `baidu` map providers must render visibly distinct states.

---

### Task 1: Lock behavioral contracts with RED tests

**Files:**
- Create: `scripts/archive-experience-redesign-tests.mjs`
- Modify: `package.json`
- Modify: `scripts/visual-audit.mjs`

**Interfaces:**
- Consumes: existing source files as text plus existing browser audit setup.
- Produces: failing assertions for `itemLimit="all"`, `tickets` layout, frosted ticket layers, compact showcase, global sync commands, and provider-specific map states.

- [ ] Add source-contract assertions for the new behavior.
- [ ] Add browser assertions for default All, ticket share preview, sync menu access, and provider-specific map state.
- [ ] Add the contract script to `npm test`.
- [ ] Trigger PR CI and verify the new tests fail for the intended missing behavior.

### Task 2: Sharing and archive visual redesign

**Files:**
- Modify: `src/shareStudio.tsx`
- Modify: `src/shareStudio.css`
- Modify: `src/archive.tsx`
- Modify: `src/archive.css`

**Interfaces:**
- Produces: `ShareLayout` value `tickets`; ticket-share DOM/canvas rendering; archive ticket frosted visual layers; compact showcase flow.

- [ ] Change `ShareStudio` default `itemLimit` to `"all"`.
- [ ] Add `tickets` to layout options and preview rendering.
- [ ] Add canvas ticket layout/drawing path using record poster plus colors.
- [ ] Refactor `TicketView` to use poster-derived blurred background and glass content.
- [ ] Replace fixed 12-column/index-modulo showcase spans with a compact responsive layout.
- [ ] Run contract tests to GREEN.

### Task 3: Global cloud sync controls and proactive remote checks

**Files:**
- Modify: `src/appController.ts`
- Modify: `src/AppRoot.tsx`
- Modify: `src/base.css`
- Modify: `src/supabase.ts` only if a dedicated pull helper is required.

**Interfaces:**
- Produces controller methods `syncNow`, `checkRemoteUpdates`, and `refreshCloudMedia`; global sync menu state; throttled remote checks.

- [ ] Expose explicit controller actions without duplicating sync logic.
- [ ] Update fingerprints after remote merges to prevent loops.
- [ ] Add visible/focus/online/low-frequency remote checks.
- [ ] Turn the top sync pill into an accessible popover with the three commands and status metadata.
- [ ] Show a one-time recovery/media-refresh hint after meaningful new-device recovery.
- [ ] Run contract tests to GREEN.

### Task 4: Real AMap provider rendering

**Files:**
- Create: `src/amap.ts`
- Modify: `src/archive.tsx`
- Modify: `src/archive.css`
- Modify: `src/settingsPage.tsx` if provider copy needs correction.

**Interfaces:**
- `loadAmap(config: { key: string; securityCode?: string }): Promise<typeof window.AMap>`
- `VenueView` consumes `settings.map` and renders `amap`, missing-key, `baidu-not-ready`, or offline-summary states.

- [ ] Add script-loader lifecycle with deduplication and security config before script insertion.
- [ ] Pass `settings.map` through `ArchiveRenderer` to `VenueView`.
- [ ] Render real AMap container and markers when configured.
- [ ] Render explicit missing-key state for AMap and explicit unavailable state for Baidu.
- [ ] Replace the inaccurate fixed-China main map with a simple offline city summary when provider is none.
- [ ] Add test/stub hooks for AMap creation and marker counts.
- [ ] Run contract tests to GREEN.

### Task 5: Full verification, review, merge, deploy

**Files:**
- Modify tests/audit only if failures reveal real regressions.

**Interfaces:**
- Consumes: completed feature branch.
- Produces: green PR and verified Pages deployment.

- [ ] Run/trigger `npm run check` and confirm success.
- [ ] Confirm PR `verify` and `visual` jobs pass.
- [ ] Download visual artifact and inspect ticket share, archive tickets, showcase, sync menu, and map states.
- [ ] Review changed-file list for temporary workflows/scripts or leaked keys.
- [ ] Mark PR ready and squash merge.
- [ ] Confirm Pages Build, Deploy, and Live SHA jobs all succeed.
