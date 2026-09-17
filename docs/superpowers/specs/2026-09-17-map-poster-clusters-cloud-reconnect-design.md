# Map Poster Clusters and Personal Cloud Reconnect Design

## Scope

This change fixes two production problems:

1. A signed-in user can recover text records but still see broken/black media until manually reconnecting the saved personal Supabase connection.
2. The AMap archive view is visually weak: every place is a generic pin, clicking opens the first record immediately, and the ranking panel is not linked to the map.

## Personal cloud recovery

The account profile already stores the linked Supabase URL, anon/publishable key, media bucket, storage mode, and media-sync preference. `settingsFromProfileBinding()` intentionally clears `ownerKey`, so every new browser session must derive a fresh owner key from the current Live Memory account before personal cloud media can be restored.

A truly new device has an additional constraint: the account text backup intentionally omits `media`. Reconnecting and merely renewing signed URLs is therefore insufficient because there may be no local `storagePath` references to sign. Recovery must first pull the full personal-cloud record/media catalog, merge those media references into the newest available text records, and only then renew signed URLs.

`syncAfterLogin()` must therefore treat reconnecting the saved personal cloud as a required recovery step when `storageMode === "supabase"` and a linked Supabase configuration is available.

Behavior:

- Attempt personal-cloud reconnect during post-login recovery.
- If it succeeds, pull the full personal-cloud media catalog before refreshing signed URLs.
- Preserve whichever text version is newer while restoring personal-cloud media references.
- If the first reconnect fails because of a transient network/cold-start condition, keep a reconnect-needed state rather than silently pretending recovery is complete.
- Retry reconnect on a bounded backoff and again when the page regains focus or network connectivity.
- Do not require the user to open Settings and press “重新连接”.
- The global cloud menu must distinguish account text sync from personal-cloud media readiness. It must be able to show: restoring personal cloud, connected, media restored, or reconnect required.
- Never delete or rewrite backup data merely because reconnect fails.

## Map interaction model

### Aggregation

The map works in the existing `city` and `venue` modes.

- City mode groups records by `record.city`.
- Venue mode groups by `city + venue`.
- Each group owns: label, count, representative coordinate, all records in the group, and a normalized heat value `count / maxCount`.

### Poster cluster markers

Generic blue pins are replaced with custom AMap HTML markers.

- Each place shows a compact stack of up to three poster thumbnails.
- The marker has a count badge.
- Visual emphasis is derived from the same normalized heat value used by the ranking panel.
- Low-frequency places use cooler/less saturated treatment; high-frequency places use warmer/stronger treatment and a slightly larger marker.
- A small low→high legend explains the encoding.

The poster thumbnails use the record poster/primary media. Missing images fall back to a neutral card rather than a broken image.

### Two-step opening

First click on a place marker does not open a record.

It selects the place and opens a floating picker anchored over the map:

- One record: one larger poster card with title/date/venue.
- Multiple records: a compact poster grid/strip for that city/venue.
- Clicking an individual record card opens the existing record detail overlay.

Clicking elsewhere on the map closes the picker.

### Ranking linkage

Map and ranking share a single selected/hovered place key.

- Hover/focus on a ranking row highlights the corresponding map marker.
- Clicking a ranking row focuses the map on that place and opens the same floating poster picker.
- Clicking a map marker highlights the matching ranking row.
- Ranking bars use the same heat color scale as map markers, so the highest-frequency city is immediately visible in both views.

## AMap wrapper changes

`src/amap.ts` remains the only AMap-specific wrapper. It must expose the minimal marker/map capabilities needed by the archive view, including custom marker content, event handlers, position updates/focus, and map click handling. No other code should directly manage script injection.

## Error handling

- Missing AMap key keeps the existing explicit configuration state.
- AMap load failure keeps the existing retry/error state.
- Personal cloud reconnect failure must not block text records from loading.
- A failed media-catalog pull or media-sign refresh must retain the recovered text records and surface a reconnect/refresh state instead of reporting “当前已是最新”.

## Testing

Add regression coverage for:

- Saved personal Supabase configuration automatically reconnects after login without manual Settings interaction.
- A new device restores the personal-cloud media catalog before renewing signed URLs.
- Newer account/local text fields are preserved while media references are restored from personal Supabase.
- Reconnect failure is retained as retryable state and is retried on focus/online.
- Successful reconnect immediately refreshes signed media URLs.
- Map groups records by city/venue and produces heat values.
- AMap uses custom poster-stack markers rather than generic `title` pins.
- First marker click selects a place/picker; individual poster click opens detail.
- Ranking click/hover shares selection/highlight state and heat encoding with map.
- General desktop/mobile visual regression remains green. The credentialed AMap branch is covered by source/type interaction contracts because CI does not contain a personal AMap credential.

## Non-goals

- No new map provider in this change.
- No database schema migration.
- No public/shared personal Supabase credentials.
- No change to record coordinates or geocoding strategy beyond using existing record coordinates and city fallbacks.
