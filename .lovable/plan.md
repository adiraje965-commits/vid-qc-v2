## Goal

Get a real spoken transcript from Bajaj Kapsule (and similar embed) videos so QC analysis is grounded in audio — without changing the URL the user pasted and without breaking the existing iframe player.

## Why it's failing

The pasted URL (`videos.bajajfinserv.in/.../embedded`) is an HTML iframe page, not a media file. ElevenLabs Scribe rejects HTML as `invalid_audio`. We need the actual `.mp4` / `.m3u8` that lives *inside* that page.

## Core principle: URL-first, player untouched

- The URL the user pasted stays the source of truth. `qc_tasks.url` and `qc_tasks.video_url` are NOT overwritten.
- The existing iframe / `<video>` player keeps using `video_url` exactly as today — embed pages keep playing in their iframe, direct mp4s keep playing in the native player.
- Resolution to a direct media file happens **only** inside the `transcribe-video` edge function and is stored in a **new** column `media_url` used **only** by transcription. The player never reads it.

## Resolver pipeline (server-side, transcribe-video)

```text
video_url (from task)
   |
   v
[1] HEAD/extension says audio/* or video/*?  --yes--> use as media_url
   | no (it's HTML)
   v
[2] Fetch HTML with browser headers (UA + Referer)
       |
       +-- og:video / og:audio meta tag           -> media_url
       +-- <video><source src=...>                -> media_url
       +-- JSON-LD VideoObject contentUrl         -> media_url
       +-- regex .mp4|.m4a|.mp3|.webm|.wav in JS  -> media_url
       +-- regex .m3u8 (HLS)                      -> media_url (HLS path)
       +-- iframe src on same page                -> recurse once
   |
   v
[3a] media_url is mp4/m4a/etc.  -> ElevenLabs Scribe (existing path)
[3b] media_url is .m3u8 (HLS)   -> Gemini 2.5 Pro via Lovable AI Gateway
                                   with fileData(mime=application/x-mpegURL)
                                   constrained to submit_transcript tool
                                   returning TranscriptSegment[]
[3c] nothing found              -> transcript_status = "unsupported_source"
                                   error_message explains + offers manual paste
```

Persist `media_url` and `media_kind` ("mp4" | "hls" | null) on `qc_tasks` so re-runs skip resolution.

## Manual fallback (does not change `video_url`)

In `TaskDetail.tsx`, when `transcript_status` is `unsupported_source` or `failed`, render a small "Transcription source" affordance under the transcript panel:

- Input: "Paste direct .mp4 URL for transcription only"
- Button: "Transcribe from this URL"
- On submit: invoke `transcribe-video` with `{ taskId, mediaUrlOverride }`. The function writes only `media_url`/`transcript`/`transcript_status`. **`video_url` is never touched**, so the player still shows the original embed.

A small caption clarifies: "Player keeps using your original URL. This is only used to fetch audio for the transcript."

## Steps

1. **Migration**
   - Add `media_url text` and `media_kind text` to `qc_tasks` (nullable). No backfill.

2. **`supabase/functions/transcribe-video/index.ts`**
   - Drop the over-eager `\/embed(ed)?` and `player\.` rejects added in the last patch — let those URLs flow into the resolver. Keep YouTube/Vimeo on the unsupported list (need yt-dlp).
   - Add `resolveMediaUrl(pageUrl)` with the pipeline above, browser headers (`User-Agent: Mozilla/5.0 ... Chrome/...`, `Referer` = page origin, `Accept: text/html,...`).
   - Branch on `media_kind`: ElevenLabs for mp4, Gemini Pro fileData for m3u8, mark unsupported otherwise.
   - Accept optional `mediaUrlOverride` in the request body — if present, skip resolution.
   - Persist `media_url`, `media_kind`, `transcript`, `transcript_status`, `error_message`. Never write `video_url`.

3. **`supabase/functions/run-qc/index.ts`**
   - No change to player wiring. Continue invoking `transcribe-video` after QC completes; the resolver now handles embeds.

4. **`src/pages/TaskDetail.tsx`**
   - Player code unchanged.
   - Transcript panel: when status is `unsupported_source` or `failed`, render the manual `mediaUrlOverride` input + button described above.
   - Show a subtle "Transcription source: <host of media_url>" line when `media_url` differs from `video_url`, so analysts know what audio was transcribed.

5. **`src/lib/qc-types.ts`**
   - Add `media_url: string | null` and `media_kind: "mp4" | "hls" | null` to `QcTask`.

## Technical details

- **HTML fetch headers** (Bajaj's Akamai gates default fetches with 403):
  - `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36`
  - `Referer: <origin>/`
  - `Accept: text/html,application/xhtml+xml,*/*;q=0.8`
- **Gemini HLS path**: POST `https://ai.gateway.lovable.dev/v1/chat/completions`, model `google/gemini-2.5-pro`, message content `[{type:"text",...},{type:"file",file:{file_data:{mime_type:"application/x-mpegURL",file_uri:<m3u8>}}}]`, force `submit_transcript({segments:[{start,end,text,speaker?}]})` tool.
- **Idempotency**: if `media_url` already set and `transcript_status === "ready"`, skip.
- **Files touched**:
  - new migration (add `media_url`, `media_kind`)
  - `supabase/functions/transcribe-video/index.ts`
  - `src/lib/qc-types.ts`
  - `src/pages/TaskDetail.tsx`

## Limitations

- DRM streams (Widevine etc.) remain untranscribable — no legitimate workaround.
- YouTube/Vimeo still need yt-dlp; those stay `unsupported_source` with the manual paste fallback.
- If Bajaj rotates to signed-cookie streams, auto-resolution may fail; the manual paste path remains.
