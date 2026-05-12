## Goal

Make Pre-live work when the user pastes a **Playbook board link with hundreds or thousands of videos**. Reviewer pastes the board URL, then searches/scrolls a paginated picker to choose the exact cut to QC.

## Approach

The current `resolve-playbook` already calls `CollectionAssetsQuery` but with `first: 40` and no pagination, no search, and the response gets dumped into a flat 3-column grid. That breaks at scale. We split it into two endpoint roles:

- `resolve-playbook` stays as the **single-shot resolver** (used once a video is selected, or when the URL already has `?assetToken=…`).
- New `list-playbook-assets` becomes the **paginated/searchable lister** for boards. Pre-live calls it lazily as the user scrolls or types.

Keeps the resolver fast and predictable, and lets the picker handle 1000s of items without timing out a single Edge Function call.

## Changes

### 1. New edge function `supabase/functions/list-playbook-assets/index.ts`

Inputs (POST JSON):
- `url` — the board share URL (`/demat/<slug>` or `/s/<org>/<slug>`)
- `cursor` — opaque, passed back to GraphQL `after` (null on first page)
- `query` — optional search string (client-side filter on title for now; server-side if Playbook supports it)
- `pageSize` — default 50, max 100

Behavior:
- Parse URL with the same `parsePlaybookUrl` helper (extract `org`, `sharedLinkSlug`).
- Resolve `collectionToken` from the rendered share page HTML (already implemented).
- Call `CollectionAssetsQuery` with `first: pageSize`, `after: cursor`, `filters: query ? { search: query } : {}` (try server-side filter; fall back to client filter if Playbook ignores it).
- Return `{ ok, assets: [{token,title,duration,thumbnail,mediaType}], nextCursor, hasMore, total? }`.
- Filter to `mediaType.startsWith("video/")` server-side so we don't ship non-videos to the client.
- Same CORS + error envelope as `resolve-playbook`.

### 2. `supabase/functions/resolve-playbook/index.ts`

Trim the board-handling branch:
- If URL has no `assetToken`, return `{ ok:false, needsAssetSelection:true, board:{ org, sharedLinkSlug } }` immediately (no `assets` array) — the picker now drives listing through `list-playbook-assets`.
- Keep the single-asset (`FullAssetModalQuery`) path unchanged.
- Keep generic-fallback ladder unchanged.

### 3. `src/pages/PreLiveNew.tsx` — paginated, searchable picker

Replace the static `assetChoices` grid (lines 188–215) with a new `<PlaybookAssetPicker>` component:
- Fires when `resolve-playbook` returns `needsAssetSelection`.
- Has a debounced search input at the top (300ms).
- Renders thumbnails in the existing grid layout but with **virtualized scroll** (use a simple windowed list — `react-window` or hand-rolled IntersectionObserver "load more" sentinel; latter avoids new dep).
- Calls `list-playbook-assets` for the next page when the sentinel scrolls into view, accumulating into local state, deduping by `token`.
- Shows skeletons while loading, "No matches" empty state, and "End of board" terminator.
- On click, runs the existing `pickAsset(asset)` flow (which appends `?assetToken` and re-resolves through `resolve-playbook` single-asset path).

Reset picker state when the URL input changes.

### 4. Client helper `src/lib/playbook-picker.ts`

Small typed wrapper around `supabase.functions.invoke("list-playbook-assets", …)` returning `{assets, nextCursor, hasMore}`. Keeps `PreLiveNew.tsx` lean.

### 5. UX copy

Update the helper text under the URL input to: "Paste a Playbook board or single-asset link. For boards, search and pick the exact cut to QC."

## Out of scope

- Bulk-queue every video on a board (option 3 from previous question — not chosen).
- Private boards / auth tokens.
- Live QC (`deep-video-review`) Playbook fast-path — Live QC continues to require a single-asset link (as in current plan); no picker added there.

## Verification

- `curl_edge_functions` POST `/list-playbook-assets` with the public board URL, `pageSize:50`, `cursor:null` → expect 50 items + `nextCursor`.
- Repeat with returned `nextCursor` → expect next 50, no overlap.
- With `query: "<known title fragment>"` → expect filtered subset.
- In `/prelive/new`: paste board URL → picker opens, scroll to load more, type to search, click a thumbnail → asset created and Deep Review starts.
- Sanity: a single-asset URL (`?assetToken=…`) still resolves directly without the picker.

## Technical notes

- Cursor is whatever Playbook's `assetsCursor.pageInfo.endCursor` returns; pass through opaquely.
- GraphQL `CollectionAssetsQuery` already exposes `pageInfo { endCursor hasNextPage }` — confirm field shape on first response and adjust if needed.
- Server-side search: try `filters: { search: query }`; if Playbook returns the same set, fall back to client filter on already-loaded pages and disable search-triggered server refetches.
- No DB schema changes.
