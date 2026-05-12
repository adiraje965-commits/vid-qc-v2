## Root cause

The Pre-live URL flow calls `resolve-playbook`, which has a Playbook fast-path that only matches paths starting with `/s/<org>/<slug>` (e.g. `playbook.com/s/demat/...`). Your link uses the bare form `playbook.com/demat/L9UHSGA3VaGW4Hc16N6J55dQ?assetToken=...` (no `/s/` prefix), so the regex returns `null`, the function falls through to the generic HTML scraper, Playbook's SPA returns no media in raw HTML, and you get the "Could not extract a direct video URL" error.

A second issue: Live QC (`deep-video-review`) has its own `resolveMediaUrl` ladder (kpoint/Bajaj-specific) and never tries the Playbook GraphQL path. So the same Playbook link wouldn't work there either.

## Changes

### 1. `supabase/functions/resolve-playbook/index.ts`
- Update `parsePlaybookUrl` to accept both Playbook share shapes:
  - `/s/<org>/<sharedLinkSlug>` (existing)
  - `/<org>/<sharedLinkSlug>` (new — what your link uses)
  - Excluding non-org reserved paths (`api`, `graphql`, `assets`, `static`, `auth`, `login`, `signup`, `_next`, `favicon.ico`, etc.) so we don't misclassify.
- When the assetToken path is taken but `asset.url` comes back null, also try the collection fallback before erroring out (some single-asset deep-links only resolve through `CollectionAssetsQuery`).
- Also probe the rendered HTML (already-fetched via `pbResolveCollectionToken`) for `assetToken=` occurrences so a board-style URL with no token still surfaces the picker reliably.

### 2. `supabase/functions/deep-video-review/index.ts`
- In `resolveMediaUrl`, before the generic `fetchPageHtml` step, add a Playbook fast-path that mirrors `resolve-playbook`:
  - Detect `playbook.com` host with the same path patterns.
  - Call the same GraphQL endpoints (`FullAssetModalQuery`, `CollectionAssetsQuery`) with `organization` + `sharedlinkslug` headers.
  - Return `{ kind: "mp4", url: asset.url }` on success.
  - On board links with multiple videos, return `{ kind: "none", reason: "Playbook board has multiple videos — open the single-asset link (with ?assetToken=…)." }` (Live QC has no picker UI).
- Factor the Playbook helpers into a small inlined block at top of the file (keep edge functions self-contained — no shared module imports across functions).

### 3. `src/pages/PreLiveNew.tsx` — no logic change
The frontend already handles `needsAssetSelection` + `directVideoUrl` shapes returned by `resolve-playbook`, so nothing needs editing here once the resolver works.

## Verification

- `supabase--curl_edge_functions` POST `/resolve-playbook` with `{"url":"https://www.playbook.com/demat/L9UHSGA3VaGW4Hc16N6J55dQ?assetToken=hDbYYo22tdCuRXJrHckhXvov"}` → expect `{ ok:true, directVideoUrl:"https://...mp4", via:"playbook-graphql" }`.
- Same call without `?assetToken=…` → expect either `ok:true` (single video) or `needsAssetSelection:true` with thumbnails.
- Re-run the original Pre-live flow in the preview at `/prelive/new` with the failing URL → asset is created and Deep Review starts.
- Quick sanity check that an unrelated URL (e.g. a kpoint Bajaj link) still resolves through Live QC.

## Out of scope

- Authenticated/private Playbook links (no public token).
- Adding a Playbook board picker to Live QC (Pre-live keeps its picker; Live QC just asks for a single-asset link).
