## Goal

When Deep Review fails, show a clear, actionable error panel that tells the user *why* (kpoint signed CDN, HLS/DRM, YouTube/Vimeo, host-blocked download, generic) and points them to the right next step (Live Capture or transcript paste), instead of the current bare red one-liner.

## Scope

Frontend only. Backend already returns descriptive `error_message` strings (e.g. "Bajaj kapsule (kpoint) videos use signed/dynamic CDN URLs…", "DRM/encrypted HLS stream — use Live Capture instead.", "Resolved to HLS (.m3u8)…"). We just classify and present them well.

## Changes

### 1. New component: `src/components/DeepReviewErrorPanel.tsx`

- Props: `errorMessage: string`, `onUseLiveCapture?: () => void`, `videoUrl?: string`.
- Classifier function `classifyResolverError(msg)` returns one of:
  - `kpoint` — matches /kpoint|bajajfinserv|kapsule/i
  - `drm_hls` — matches /DRM|encrypted|HLS|\.m3u8/i
  - `youtube_vimeo` — matches /YouTube|Vimeo/i
  - `host_blocked` — matches /403|blocked|Host may block|server-side download/i
  - `no_media` — matches /No direct media file/i
  - `unknown` — fallback
- Renders an `Alert` (destructive) with:
  - Title: short human label ("Signed CDN video (Bajaj kapsule)", "DRM / HLS stream", etc.)
  - Description: the raw resolver reason in muted text + a one-line "What to do" recommendation.
  - Action button(s):
    - For `kpoint`, `drm_hls`, `youtube_vimeo`, `host_blocked`: primary button **"Use Live Capture"** that scrolls to / focuses the `VideoCapture` panel (via `document.getElementById("live-capture")?.scrollIntoView`).
    - For `no_media` / `unknown`: secondary **"Open source page"** link to `videoUrl`.
    - Always: small **"Copy error"** ghost button.

### 2. `src/pages/TaskDetail.tsx`

- Replace the current line-149 inline red div with `<DeepReviewErrorPanel errorMessage={task.error_message} videoUrl={task.video_url} />` (only when `task.status === "failed"` and an error message exists).
- Add `id="live-capture"` to the wrapper around `<VideoCapture …/>` so the action button can scroll to it.
- Keep behavior unchanged for non-deep-review failures (the same panel handles them gracefully via the `unknown` branch).

### 3. `src/components/DeepReviewPanel.tsx`

- After `supabase.functions.invoke` rejects, also surface the classified short label in the toast title (e.g. "Deep review failed · Signed CDN video"), keeping the description as the raw message. Pure presentation, no logic change.

## Out of scope

- No backend / resolver changes.
- No new DB columns; we keep using existing `error_message`.
- No changes to Live Capture behavior itself.

## Verification

- Trigger Deep Review on the existing failing Bajaj kapsule task → expect the new "Signed CDN video (Bajaj kapsule)" panel with a Live Capture CTA that scrolls to the capture component.
- Manually set `error_message` to an HLS / YouTube / generic string in dev to confirm each branch renders the right label and CTA.
