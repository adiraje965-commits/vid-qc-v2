## Goal

Browser-side video capture for **real** QC: actual frame analysis (visual + supers/OCR) + reliable transcript from gated sources like Bajaj. Gated-host 403 ka problem khatam, kyunki capture user ke browser mein hota hai jahan player already auth-ed hai.

## Architecture

```text
TaskDetail page
  └─ <VideoCapture> component (mounts when transcript_status != 'ready')
       ├─ <video crossOrigin="anonymous" src={video_url}>  ← already plays in browser
       ├─ MediaRecorder(audio track) → 30s WebM/Opus chunks
       │     └─ POST /transcribe-chunk  (binary upload)
       │           └─ ElevenLabs STT → append segments to qc_tasks.transcript
       └─ Frame sampler: every 2s → canvas.toBlob('image/jpeg', 0.7) → queue
             └─ POST /analyze-frames  (batch of 4 frames + transcript window)
                   └─ Gemini 2.5 Flash Vision:
                        • describe scene
                        • OCR all on-screen text (supers, CTAs, disclaimers)
                        • flag QC issues with real timestamps
                   └─ insert into qc_issues + update key_frames
```

End of capture → mark `transcript_status='ready'`, recompute `overall_score` with real signals.

## Steps

### 1. New edge function: `transcribe-chunk`
- Accepts `multipart/form-data`: `taskId`, `startSec`, audio blob
- Sends blob to ElevenLabs `speech-to-text` (already wired in `transcribe-video`, copy that helper)
- Appends returned segments (offset by `startSec`) into `qc_tasks.transcript` JSONB
- Returns `{ ok, appended }`

### 2. New edge function: `analyze-frames`
- Accepts JSON: `taskId`, `frames: [{ tsSec, dataUrl }]`, `transcriptWindow: string`, `pageContext: string`
- Calls Gemini 2.5 Flash via Lovable AI Gateway with multimodal `image_url` parts (data URLs work)
- Tool-call schema returns `{ frame_observations: [{ts, scene, on_screen_text[], issues[]}], key_frames[] }`
- Inserts new `qc_issues` rows, merges `key_frames` into `qc_tasks.key_frames`

### 3. New component: `src/components/VideoCapture.tsx`
- Auto-starts when `task.video_url` set and `transcript_status` is `pending` or null
- Mutes the visible player (separate hidden `<video>` for capture, autoplay+muted; or reuse existing — use hidden one to avoid disturbing UX)
- Uses `video.captureStream()` → `MediaRecorder({ mimeType: 'audio/webm;codecs=opus' })`
- On every `dataavailable` (timeslice 30000ms) → upload chunk
- Frame loop: `requestVideoFrameCallback` throttled to 2s intervals → canvas snapshot → buffer 4 → POST batch
- On `ended` event → finalize: mark task ready, trigger one final score recompute via existing `run-qc` (with `skipScrape: true`) OR a new lightweight `finalize-qc` endpoint that just recomputes counts + overall from the now-real issues. Use the lightweight finalize approach.
- Shows a small badge: "Live QC capture in progress · Xs / Ys"
- `crossOrigin="anonymous"` — if the video host blocks CORS for canvas (taints), fall back: skip frame analysis, keep audio capture only, show toast "Visual QC unavailable for this host (CORS); transcript still captured."

### 4. New edge function: `finalize-qc`
- Recompute counts from `qc_issues` rows for taskId, recompute bucket scores using existing penalty logic, set `transcript_status='ready'`, `status='completed'`.

### 5. Tweak `run-qc`: stop firing `transcribe-video` automatically
- Browser capture replaces it. Keep `transcribe-video` as manual fallback button (already exists in TaskDetail).
- Keep server-side `transcribe-video` for cases where user closes the tab (best-effort) — but disable auto-invoke and let `VideoCapture` own the path.

### 6. UI
- Add `VideoCapture` mount in `TaskDetail.tsx` near the player
- Status pill: "Capturing audio + frames" → "Analyzing" → "QC complete"

## Files

**New**
- `supabase/functions/transcribe-chunk/index.ts`
- `supabase/functions/analyze-frames/index.ts`
- `supabase/functions/finalize-qc/index.ts`
- `src/components/VideoCapture.tsx`

**Edited**
- `src/pages/TaskDetail.tsx` (mount VideoCapture)
- `supabase/functions/run-qc/index.ts` (remove auto-transcribe-video invocation; capture-driven now)

No DB migration — `qc_tasks.transcript`, `key_frames`, `transcript_status` already exist; `qc_issues` schema unchanged.

## Acceptance

- Bajaj task: opens TaskDetail → capture starts → after ~30s real transcript segments appear; after ~60s real visual issues with accurate timestamps + super text appear; final scores reflect real findings.
- Open-host MP4: same flow, no 403 anywhere.
- CORS-tainted host: audio transcript still works; UI shows visual-QC-unavailable note.
- No edge-function 403 spam in logs (since we no longer fetch the source server-side).

## Limitations

- Tab must stay open during capture (~video duration). Acceptable for a QC tool.
- CORS-locked hosts → no canvas frames; audio still flows because `MediaRecorder` doesn't need CORS.
- DRM (Widevine/FairPlay) → MediaRecorder can't capture protected streams; we detect and show clear message.
