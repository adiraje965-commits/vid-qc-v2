## Add Video Transcript View with Timeline Sync

Add a transcript panel below the video player in the Task Detail view. Transcript segments highlight as the video plays, and clicking a segment seeks the player.

### 1. Database

Add a `transcript` column to `qc_tasks` to store timestamped segments:

```sql
ALTER TABLE public.qc_tasks
ADD COLUMN transcript jsonb DEFAULT '[]'::jsonb;
```

Segment shape:
```ts
{ start: number; end: number; text: string; speaker?: string }
```

### 2. Generate transcript in `run-qc` edge function

Update `supabase/functions/run-qc/index.ts` so that, alongside the QC analysis, Gemini also returns a transcript array. Two approaches:

- **Primary**: Ask Gemini (`google/gemini-2.5-pro`) to generate a timestamped transcript from the video URL in the same call that does QC, by extending the JSON schema to include a `transcript: [{start, end, text, speaker?}]` field.
- **Fallback**: If the model can't access the video directly (e.g. Bajaj embeds), produce a synthesized transcript from `page_markdown` + key frames with approximate timestamps, clearly marked as inferred.

Persist the array to `qc_tasks.transcript`.

### 3. Type updates

- `src/integrations/supabase/types.ts` regenerates automatically.
- Add `TranscriptSegment` and `transcript: TranscriptSegment[]` to `QcTask` in `src/lib/qc-types.ts`.

### 4. UI — `src/pages/TaskDetail.tsx`

Add a new `TranscriptPanel` section directly below the player card (above Severity Breakdown on the left column).

Features:
- Scrollable list (using `ScrollArea`) of segments showing `[mm:ss] text`.
- Active segment (where `currentTime` is within `[start, end]`) is highlighted with `bg-primary/10` and a left border, and auto-scrolls into view.
- Click a segment → calls existing `seek(start)` to jump the video.
- Header row: title "Transcript", a search input to filter segments, and a copy-all button.
- Empty state: "Transcript not available for this video" when `transcript` is empty.
- While `task.status === "processing"`, show a skeleton loader.

Implementation notes:
- Track active index via a `useEffect` watching `currentTime`.
- Use a `ref` map to scroll the active row into view with `scrollIntoView({ block: "nearest", behavior: "smooth" })`.
- Reuse existing `currentTime` / `seek` already wired to `videoRef`.

### 5. Realtime

The existing realtime subscription on `qc_tasks` already refetches the row on update, so the transcript will appear live as soon as `run-qc` writes it.

### Files touched

- New migration adding `transcript` column
- `supabase/functions/run-qc/index.ts` — extend prompt + persist transcript
- `src/lib/qc-types.ts` — add types
- `src/pages/TaskDetail.tsx` — render `TranscriptPanel` with sync + click-to-seek
