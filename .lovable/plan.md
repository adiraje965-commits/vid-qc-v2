## Goal

Make `transcribe-video` actually succeed on Bajaj Kapsule and similar bot-gated embeds, without touching the player or the URL the user pasted.

## Root cause (confirmed)

Direct fetch from the edge function gets `403 Access Denied` from Akamai (Bajaj's CDN). Browser-like headers alone don't pass — Akamai also fingerprints TLS and runs a bot challenge that Deno's fetch can't solve. Every Bajaj task currently lands on `unsupported_source` with `Source returned 403 Forbidden`.

## Strategy

Layered improvements, all server-side, additive on top of the existing resolver.

```text
sourceUrl
  |
  v
[1] direct fetch (current path) — works for open hosts, ~free
  |  on 403 / 401 / 451 / 503 / Access-Denied body
  v
[2] Firecrawl scrape (rawHtml + links)
       - real headless browser, JS rendered, anti-bot bypass
  |
  v
[3] Deeper extractor (existing + new signals)
       existing: og:video, <source>, JSON-LD, regex mp4/m3u8, iframe
       NEW: <script> JSON walks (__NEXT_DATA__, __INITIAL_STATE__,
            Apollo, Redux) for *Url / playbackUrl / manifestUrl / src
       NEW: data-* attribute scan
       NEW: base64-encoded URL decode pass
       NEW: Firecrawl `links` array filtered by media extension
       NEW: iframe recursion routed through Firecrawl too
  |
  v
[4] Validate candidate before spending STT budget
       - HEAD with Range: bytes=0-0 + browser headers + Referer
       - if HLS, fetch manifest text:
           * master playlist → pick highest BANDWIDTH variant
           * has #EXT-X-KEY METHOD!=NONE → reject as DRM
  |
  v
[5] Transcribe (unchanged): ElevenLabs for mp4, Gemini Pro for hls
```

## Why Firecrawl

- Already connected (`FIRECRAWL_API_KEY` in secrets, used by `scrape-page`).
- Bypasses Akamai/Cloudflare bot walls by running a real browser.
- Returns `rawHtml` (post-JS), which is exactly where the player constructs the `.mp4`/`.m3u8` URL at runtime.
- Only invoked when direct fetch fails — open hosts stay on the cheap path, so credit usage stays low.

## Steps

1. **`supabase/functions/transcribe-video/index.ts`** — single file, no DB migration (`media_url`/`media_kind` already exist).
   - `fetchPageHtml(url)`: try direct fetch; on bot-gate fall back to Firecrawl `POST /v2/scrape` with `formats: ['rawHtml','links']`, `onlyMainContent: false`, `waitFor: 2500`, `location: { country: 'IN', languages: ['en'] }`.
   - Bot-gate detection: status ∈ {401,403,451,503} OR body length < 2KB AND contains `Access Denied | Reference # | Just a moment | Attention Required | cf-browser-verification`.
   - Expand `findMediaInHtml` with the new signals listed above.
   - Iframe recursion routed through `fetchPageHtml` (so children also get Firecrawl when blocked).
   - `validateMedia(url, kind)`: HEAD `Range: bytes=0-0` with browser headers + `Referer` = original page origin; HLS master playlist picker; encrypted-stream rejection.
   - Idempotency: if `media_url` set and `transcript_status === 'ready'`, skip.
   - On Firecrawl 402 (insufficient credits): set `unsupported_source` with a precise message so the manual override path remains usable.
   - Structured logs tagged `[resolve]` indicating which path matched (`direct`, `firecrawl`, `iframe-recurse`, `script-json`, `links`).

2. **`src/pages/TaskDetail.tsx`** — copy tweak only (~5 lines):
   - When `error_message` mentions `403`, `Access Denied`, or `bot`, show: "This host blocks automated fetching. The video still plays above; we tried a rendered-browser fallback. If it still failed, paste a direct .mp4 URL below."
   - Existing manual `mediaUrlOverride` UI stays as-is.

3. **No DB migration. No player changes. No client realtime work.**

## Files touched

- `supabase/functions/transcribe-video/index.ts` (substantial additions, same exports)
- `src/pages/TaskDetail.tsx` (copy tweak)

## Acceptance

- Re-running QC on `9539d1c2…` and `9cc285fc…` (existing Bajaj tasks) populates `media_url`, sets `transcript_status='ready'`, and stores a non-empty transcript.
- Open hosts (direct .mp4) still resolve on the fast path — no Firecrawl call, no extra credits.
- DRM/encrypted streams cleanly return `unsupported_source` with reason "DRM/encrypted stream" instead of failing mid-transcription.
- Manual `mediaUrlOverride` continues to work and skips both fetches.

## Limitations (unchanged)

- Widevine/FairPlay DRM: untranscribable. We now fail cleanly with a clear reason.
- YouTube/Vimeo: still need yt-dlp; out of scope. Manual paste fallback covers them.
- Firecrawl credit exhaustion: degrades gracefully to manual paste with a clear message.
