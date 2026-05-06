## Auto-populate transcripts from the actual video audio

### Why the current behaviour is wrong

Today `run-qc` asks Gemini (via the Lovable AI Gateway) to "infer" a transcript from page markdown + key frames. The gateway's chat-completions endpoint does not actually fetch or listen to the video, so the transcript is hallucinated text loosely related to the page — not what is spoken in the video. We need real speech-to-text on the video file itself.

### Approach

Use the **ElevenLabs** connector (Scribe speech-to-text). ElevenLabs STT accepts a public audio/video URL or a file upload and returns word-level timestamps which we group into 2-6s segments. This works for direct `.mp4` / Bajaj video URLs. For YouTube/Vimeo (no public media URL) we will fall back to a clear "Transcript unavailable for embedded YouTube/Vimeo videos — only direct video files are supported" empty state instead of fabricating one.

### Steps

1. **Add ElevenLabs connector**
   - Call `standard_connectors--connect` with `connector_id: elevenlabs` so `ELEVENLABS_API_KEY` is available to edge functions. (Direct API, not gateway — ElevenLabs is `uses connector gateway: false`.)

2. **New edge function `transcribe-video`** (`supabase/functions/transcribe-video/index.ts`)
   - Input: `{ taskId, videoUrl }`.
   - If `videoUrl` is YouTube / Vimeo / missing → write `transcript: []` and a small marker (`transcript_status: "unsupported_source"`) and return.
   - Otherwise POST to `https://api.elevenlabs.io/v1/speech-to-text` with:
     - `model_id: scribe_v1`
     - `cloud_storage_url: <videoUrl>` (Scribe accepts remote URLs; if the URL is not directly fetchable we stream-download with `fetch` and forward as multipart `file`).
     - `timestamps_granularity: "word"`, `diarize: true`.
   - Group the returned words into segments of ~3s (break on speaker change or sentence punctuation), shape `{ start, end, text, speaker }`.
   - Persist via service-role client to `qc_tasks.transcript`.

3. **Wire it into `run-qc`**
   - Remove the `transcript` field from the Gemini tool schema and prompt — Gemini should no longer invent transcripts.
   - After `run-qc` finishes its QC update, fire-and-forget invoke `transcribe-video` with the same `taskId` + `videoUrl` (don't block QC completion on STT, which can take 10-60s on long clips).
   - The existing realtime subscription on `qc_tasks` in `TaskDetail.tsx` will refresh the transcript panel as soon as `transcribe-video` writes the row.

4. **Schema**
   - Add `transcript_status text` (nullable) to `qc_tasks` so the UI can distinguish `pending`, `ready`, `unsupported_source`, `failed`. Migration via the migration tool.

5. **UI updates (`src/pages/TaskDetail.tsx`)**
   - Replace the current generic empty state with three states driven by `transcript_status`:
     - `pending` → spinner + "Transcribing audio…"
     - `unsupported_source` → "Transcript not available — embedded YouTube/Vimeo player. Provide a direct .mp4 to enable transcription."
     - `failed` → error + retry button that re-invokes `transcribe-video`.
   - Keep existing timeline-sync, click-to-seek, search, and copy-all behaviour.

6. **Type updates**
   - `src/lib/qc-types.ts`: add `transcript_status?: "pending" | "ready" | "unsupported_source" | "failed" | null` to `QcTask`.

### Files touched

- `standard_connectors--connect` (ElevenLabs)
- New migration: add `transcript_status` column
- New `supabase/functions/transcribe-video/index.ts`
- `supabase/functions/run-qc/index.ts` — drop transcript prompt, kick off `transcribe-video`
- `src/lib/qc-types.ts` — add `transcript_status`
- `src/pages/TaskDetail.tsx` — status-aware transcript panel + retry

### Notes / limitations

- YouTube and Vimeo embeds intentionally do not expose an audio stream; real transcription there requires a separate yt-dlp-style backend, which we are not adding now. We surface this clearly instead of faking it.
- Existing tasks created before this change will keep their old (inferred) transcript; running QC again on the same video will overwrite it with the real one.
