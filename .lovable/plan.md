
## Diagnosis

Two separate bugs are stacked on top of each other.

### 1. Transcript box shows page text — by design, but wrong

You are currently viewing a **local** task (`/task/local_...`). Local tasks never call any transcription service. Instead `src/lib/local-qc.ts › buildTranscriptDraft()` slices the scraped page markdown into 5-second fake segments and stores them in `task.transcript` with `transcript_status: "ready"` and the speaker label `"Page copy draft"`. The Transcript panel then renders that page copy as if it were the spoken transcript. So what you're seeing is exactly the page paragraphs, formatted as `[00:00] Page copy draft: …`.

### 2. Run Deep Review fails for the Bajaj kapsule URL

Edge logs for the last attempt:

```
Resolving Bajaj kapsule embed: https://videos.bajajfinserv.in/kapsule/gcc-…/nv3/embedded
Downloading video: https://videos.bajajfinserv.in/kapsule/gcc-…/nv3/embedded
deep-video-review error: Could not fetch video (403). Host may block server-side downloads — try Live Capture.
```

What happened:

- `videos.bajajfinserv.in` sits behind **Akamai** and returns **HTTP 403 Access Denied** to non-Indian IPs (the Supabase edge runtime is outside India). I reproduced this from the sandbox: the kapsule embed returns Akamai's "Access Denied / Reference #18.…" HTML.
- The `kapsuleUrlResolver` block in `supabase/functions/deep-video-review/index.ts` does a plain `fetch(videoUrl)`, gets the Access Denied HTML, finds no `.mp4` regex match → falls through to `Downloading video: <embed page>` → the next `fetch` returns 403 → the function 500s.
- `transcribe-video/index.ts` already solved exactly this problem: it uses `fetchPageHtml()` which falls back to **Firecrawl with `location: { country: "IN" }`** when direct fetch is blocked, then walks JSON blobs / `<source>` / `og:video` / iframe srcs to find the real `.mp4` or `.m3u8`. `deep-video-review` does not reuse this code, so it has no chance of resolving Akamai-protected embeds.

A secondary UX issue: when `DeepReviewPanel.run()` is invoked on a local task it does `ensureCloudTask()` → `invoke("deep-video-review")` → navigate **only on success**. If the function 500s the user stays on the local task page with just a red toast and no breadcrumb to the cloud task that was just created.

---

## Fix plan

### A. `supabase/functions/deep-video-review/index.ts` — port the Firecrawl-aware resolver

Replace the small `kapsuleUrlResolver` block + naive download with a resolver modeled on `transcribe-video/index.ts`:

1. Add `BROWSER_HEADERS` (real Chrome UA + `Accept-Language`) and a `FIRECRAWL_API_KEY` import.
2. Add helpers: `classifyByExt`, `classifyByContentType`, `findMediaInHtml` (scans `og:video`, `<video>/<source>`, `data-*`, JSON-LD, generic `__NEXT_DATA__`/inline JSON, base64 strings, regex over the document, `<iframe src>` recursion).
3. Add `firecrawlScrape(url)` that calls Firecrawl `v2/scrape` with `formats: ["rawHtml","links"]`, `waitFor: 2500`, `location: { country: "IN" }` so Akamai sees an Indian browser.
4. Add `fetchPageHtml(url)` that does a direct fetch first, detects Akamai/Cloudflare bot walls (`looksBlocked`), and falls back to Firecrawl.
5. Add `resolveMediaUrl(url)` — same shape as the transcribe version: extension shortcut → page fetch → media in HTML → iframe recursion (depth ≤ 1) → HLS variant picker (rejects DRM).
6. Replace the current "if kapsule then fetch+regex" block with a single `const resolved = await resolveMediaUrl(videoUrl)`. If `resolved.kind === "none"`, throw a friendly error including `resolved.reason` (e.g. "DRM/encrypted HLS" → tell user to use Live Capture).
7. Use `resolved.url` as the actual download URL; pass `resolved.kind` to set the correct mime when the response's `Content-Type` is missing.

This is the only change needed for the kapsule case to actually produce a downloadable `.mp4` / `.m3u8`.

### B. `src/lib/local-qc.ts` — stop faking the transcript

In `createLocalTaskForVideo`:

- Remove `buildTranscriptDraft(...)` from the task payload.
- Set `transcript: []` and `transcript_status: "pending"` (so the Transcript panel shows the existing "Pending — run Deep Review or paste a transcript" empty state instead of misleading page copy).
- Keep the `buildTranscriptDraft` function for now but don't call it (or delete it — it isn't referenced anywhere else).

The Transcript panel already has good empty-state UX (`showPending`) and a "Paste transcript" path, so nothing else needs to change client-side.

### C. `src/components/DeepReviewPanel.tsx` — navigate immediately for local→cloud handoff

In `run()`:

1. `const cloudTaskId = await ensureCloudTask();`
2. If `cloudTaskId !== taskId`, navigate to `/task/${cloudTaskId}` **before** awaiting the function call, so the user lands on the new cloud task and sees its live status (processing → completed/failed) instead of being stuck on the dead local task with only a toast.
3. Keep the toast on completion/failure — TaskDetail already auto-refreshes via Supabase subscriptions / its existing fetch.

No business-logic changes beyond the resolver port and the local-transcript flag flip.

---

## Out of scope / known limits

- If the Bajaj kapsule is **DRM-protected HLS** (some kapsules are), even Firecrawl-via-IN can't decrypt it. The new resolver will surface a clear `"DRM/encrypted HLS stream — cannot transcribe."` error and the user should use **Live Capture** for that video. This is the same boundary `transcribe-video` already enforces.
- No DB schema changes. No auth changes. Frontend transcript UI is unchanged — only what we put into `transcript` for local tasks changes.

## Files to edit

- `supabase/functions/deep-video-review/index.ts` — port resolver from `transcribe-video`.
- `src/lib/local-qc.ts` — drop fake transcript draft.
- `src/components/DeepReviewPanel.tsx` — navigate to cloud task before awaiting deep review.
