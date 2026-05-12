## Goal

Make `resolve-playbook` reliably return a direct MP4 URL for any `https://www.playbook.com/s/<org>/<slug>?assetToken=<token>` link (and gracefully list multi-asset boards), instead of failing because the page is a JS-rendered SPA with no embedded media URL.

## Discovery (verified live)

Playbook's shared pages render via GraphQL. The HTML contains no media — only `data-organization-slug`, `data-shared-link-slug`, `data-collection-token`. The browser then hits `https://www.playbook.com/graphql` with three identifying headers, no auth, and the response carries the signed direct video URL.

Working call (verified with curl, no cookies/auth):

```
GET https://www.playbook.com/graphql
  ?operationName=FullAssetModalQuery
  &variables={"assetToken":"<assetToken>"}
  &extensions={"operationId":"graphql-frontend-prod/e88447f0bab7b7d6bfd2364dd2253858"}
Headers:
  organization: <org-slug>           // from /s/<org>/<slug>
  sharedlinkslug: <shared-link-slug> // from /s/<org>/<slug>
  clienttype: web-app
  accept: */*
```

Response → `data.asset.url` is a signed `https://prod.playbookstatic.com/v0/...?ttl=daily&verify=...` MP4 (TTL ~24h), with `mediaType: "video/mp4"`, `title`, `duration`, plus `safeThumbnail.url` and `thumbnails[]` for poster.

For boards without `assetToken`, the same endpoint with `operationName=CollectionAssetsQuery` (operationId `02aafb123aa4f9ad468834c746542cb1`, vars include `collectionToken`) returns the asset list with the same `url` field per asset.

## Changes

### 1) `supabase/functions/resolve-playbook/index.ts` — add a Playbook fast path

Before the generic HTML/Firecrawl ladder, detect Playbook URLs and call the GraphQL API directly:

- Parse URL: match `^https?://(www\.)?playbook\.com/s/(?<org>[^/]+)/(?<slug>[^/?#]+)` and `?assetToken=<token>`.
- If `assetToken` present → call `FullAssetModalQuery` and return `{ ok:true, directVideoUrl: asset.url, thumbnailUrl: safeThumbnail.url ?? thumbnails[0].url, title, via:"playbook-graphql" }`.
- If no `assetToken` → call `CollectionAssetsQuery` (need `collectionToken`; resolve by first scraping the share page HTML for `data-collection-token` once, then GraphQL):
  - If exactly one video asset → return its `url` like above.
  - If multiple → return `{ ok:false, needsAssetSelection:true, assets:[{token,title,thumbnail,duration,mediaType}] }` so the UI can prompt the user to pick one.
- Only video assets (`mediaType` starts with `video/`) are eligible.
- Keep the existing generic ladder as fallback for non-Playbook URLs (no behavior change for Bajaj/etc.).

Edge cases: shared link requires login (GraphQL returns `errors` / null asset) → return a clear "this Playbook link is private; sign in or share publicly" error. Signed URL TTL → not our problem at resolve time; deep-review consumes it within minutes.

### 2) Client UX in `src/pages/PreLiveNew.tsx`

- When `resolve-playbook` returns `needsAssetSelection`, show an inline picker (radio list of thumbnails/titles) and re-call `resolve-playbook` with the chosen `assetToken` appended to the URL. No new pages — just a small section that replaces the URL input area until a choice is made.
- Show the resolved title/thumbnail as a small confirmation card before "Create & run Deep Review" so the user sees what got picked.

### 3) Hint text in the URL input

Update the existing helper line under the URL field to: "Paste a Playbook share link (board or single-asset link). For boards we'll let you pick which cut." Drop the "if Playbook resolution fails" sentence since it should now Just Work for public links.

## Out of scope

- Authenticated/private Playbook links (no token to pass).
- Playbook upload, write, comments-back integration.
- Replacing the generic resolver — only adding a Playbook fast path.

## Verification

1. Paste the failing URL (`/s/demat/MzU4...?assetToken=hDbY...`) → asset created, Deep Review starts (verified the GraphQL call returns the MP4).
2. Paste a board URL without `assetToken` → picker appears with the asset(s); selecting one resolves and proceeds.
3. Paste a non-Playbook MP4/HTML URL → unchanged behavior.
