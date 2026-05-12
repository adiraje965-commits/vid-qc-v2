## Assessment

The issue is not that the Playbook board is private anymore. The current backend function tries to find `data-collection-token` only in one exact HTML attribute shape. Playbook public pages also expose the same token inside embedded page data as `collectionToken`, and the prior implementation can misclassify a public board as “private or invalid” when that attribute is missing or not returned in the expected shape.

I also found a second related problem: if a user pastes a bare Playbook asset URL like `/demat/...?...assetToken=...`, `resolve-playbook` can fail because single-asset GraphQL resolution needs the canonical `/s/<org>/<boardSlug>?assetToken=...` context. This means selected videos from the picker can work, while older/bare copied URLs can still fail.

## Plan

1. Harden Playbook board token extraction in `list-playbook-assets`
   - Keep the existing `data-collection-token` extraction.
   - Add fallback extraction for escaped JSON/Next data shapes such as `collectionToken\":\"...\"` and normal JSON `"collectionToken":"..."`.
   - Return a more accurate error if the page is accessible but no collection token can be found.

2. Make Playbook URL parsing canonical
   - Normalize bare `https://www.playbook.com/<org>/<slug>` board URLs to the public share route `https://www.playbook.com/s/<org>/<slug>` when scraping board HTML.
   - Preserve support for `/s/<org>/<slug>` links.

3. Fix single-asset Playbook resolution consistency
   - Update `resolve-playbook` to use the same robust collection token extraction helper.
   - For `assetToken` links, first attempt direct `FullAssetModalQuery` as today.
   - If that fails for a bare/copied URL, fall back to board listing via collection token and match the requested `assetToken`, then return the direct video URL from the matched asset.

4. Improve diagnostics without exposing internals
   - Log which extraction path failed server-side.
   - Keep user-facing errors simple: public board unreadable, no videos found, or selected asset unavailable.

5. Validate with real Playbook URLs
   - Test `list-playbook-assets` against the board URLs seen in the network logs.
   - Test `resolve-playbook` against a selected `assetToken` URL.
   - Confirm the picker displays videos and selecting one produces a resolvable direct video URL.