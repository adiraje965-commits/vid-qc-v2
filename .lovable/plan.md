## Problem

The Deep Review toast shows `Deep review failed · … [object Object]`. That happens because:

1. In `DeepReviewPanel.run()`, when the edge function returns a JSON body like `{ error: { message: "..." } }`, the code does `throw new Error((data as any).error)` — passing an **object** to `new Error()`, which stringifies to `"[object Object]"`.
2. Similarly, `supabase.functions.invoke` errors (`FunctionsHttpError`) carry the real reason in `error.context` / response body, not always in `error.message`. We currently only read `e.message`.

Because the message is opaque, we also can't tell *why* `deep-video-review` is failing (and edge logs show no invocation, suggesting the failure may be in `ensureCloudTask`'s insert into `qc_tasks` — likely an RLS / non-null constraint issue now that we insert with `owner_id: null` while logged in).

## Plan

### 1. Robust error extraction in `DeepReviewPanel.tsx`

- Add a small `extractErrorMessage(e)` helper that handles:
  - `Error` instances (use `.message`)
  - Supabase `FunctionsHttpError` — `await e.context.json()` (or `.text()`) to get the real server payload, then pull `.error` / `.message`
  - Plain objects — `JSON.stringify` with fallback
  - Strings
- Replace `throw new Error((data as any).error)` with logic that turns object-shaped errors into a readable string before throwing.
- Log the raw error to `console.error` for debugging.

### 2. Make `ensureCloudTask` failures visible

- Wrap the `qc_tasks` insert error with a clear prefix like `Failed to create cloud task: <pg message>` so RLS / column errors show up in the toast instead of being collapsed to `[object Object]`.

### 3. Verify after fix

- User clicks Run Deep Review again; toast now shows the real reason (e.g. RLS violation on `qc_tasks`, missing `video_url`, or actual function error).
- Then we address that root cause in a follow-up (likely setting `owner_id` to the current `auth.uid()` instead of `null`, which is the most likely culprit given current RLS policies).

### Files to edit

- `src/components/DeepReviewPanel.tsx` — error extraction + better `ensureCloudTask` error message.

No backend changes in this step; we first need the real error message to decide the next fix.
