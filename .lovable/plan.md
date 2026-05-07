## Root cause

Recent Deep Review runs against `videos.bajajfinserv.in/kapsule/gcc-…/nv3/embedded` URLs fail with **"Bajaj kapsule (kpoint) videos use signed/dynamic CDN URLs…"** or **"No direct media file found inside the page."**

Edge logs (08:26–08:27Z):
```
direct: blocked, falling back to firecrawl { status: 403, len: 469 }   // Akamai access denied
firecrawl: ok { htmlLen: 25414, links: 2 }
deep-video-review error: Bajaj kapsule (kpoint) videos use signed/dynamic CDN URLs …
```

The previous successful run (task `8a5ccbe8…`, 08:24Z) was a **`nv4/embedded`** URL whose Firecrawl HTML still exposed the kpoint `playlist.m3u8`. The new `nv3/embedded` HTML no longer contains it, so `findMediaInHtml` returns nothing and the kpoint guard short-circuits with a "use Live Capture" error.

I verified by curl that the kpoint HLS manifest is in fact **deterministic and publicly fetchable** (no signing) for these kapsule IDs:

```
https://media-mp.kpoint.com/data.ap-south-1.kpoint/bajaj-finance-marketing.kpoint.com/
  videos.bajajfinserv.in/kapsule/<gcc-ID>/v32/view/html5/hls-1080p/playlist.m3u8
```

Both failing IDs (`gcc-258d1fc2…` and `gcc-64bdefbe…`) returned `200 OK` with valid `#EXTM3U` playlists. So the fix is to **construct that URL from the kapsule ID** instead of giving up.

## Plan — single-file change to `supabase/functions/deep-video-review/index.ts`

### 1. Add `tryKpointDirect(input)` helper

- Match the kapsule ID with regex `/videos\.bajajfinserv\.in\/(?:kapsule|web\/videos)\/(gcc-[a-f0-9-]+)/i` against both the input URL and (later) the resolved page URL.
- For each candidate, build the deterministic HLS URL using the pattern above.
- Try resolutions in this order, returning the first one whose manifest fetch returns `200`:
  1. `hls-1080p/playlist.m3u8`
  2. `hls-720p/playlist.m3u8`
  3. `hls-480p/playlist.m3u8`
  4. `playlist.m3u8` (no resolution segment, fallback)
- On success, return `{ kind: "hls", url }`. On all-failures, return `null`.

### 2. Wire it into `resolveMediaUrl`

- **Before** the existing `fetchPageHtml` call: if input matches a kapsule ID, call `tryKpointDirect(input)` first and return that on success. Avoids the Akamai 403 + Firecrawl roundtrip entirely.
- **After** `findMediaInHtml` returns no match, but **before** the current "Bajaj kapsule (kpoint)" hard-fail: try `tryKpointDirect(page.finalUrl)` again (covers cases where input was an indirect link that redirected to a kapsule embed).

### 3. Keep the existing kpoint hard-fail message as the *last-resort* branch

If both deterministic attempts fail (e.g. kpoint changes their URL scheme), the user still gets the "Use Live Capture" CTA via the existing `DeepReviewErrorPanel` classifier.

## Verification

1. Deploy `deep-video-review`.
2. Re-run Deep Review on existing failing tasks `d8906f51…` and `47accf93…`. Expect:
   - logs: `[resolve] kpoint-direct ok …playlist.m3u8`
   - `qc_tasks.status = completed` with non-null `media_url`/`media_kind=hls`, transcript and issues populated.
3. Confirm the previously-working `nv4/embedded` flow still works (it will hit the kpoint-direct path first now, but the URL pattern is the same).
4. Confirm a non-kpoint URL (e.g. the MDN flower mp4) still resolves via the existing classify-by-ext path.

## Out of scope

- No frontend changes — `DeepReviewErrorPanel` already classifies the remaining failure modes correctly.
- No DB schema changes.
- No changes to `run-qc`, `transcribe-video`, or Live Capture.
