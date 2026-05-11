## Pre-Live MP4 QC Workflow (via Playbook) — Upload + Versions + Diff

Adds a parallel "Pre-Live" track to the existing post-live (URL → scrape) flow, sourcing draft MP4s from **Playbook** share links, supporting **multiple versions (v1 → v2 → vN)** of the same asset, and a **version diff view** (fixed / regressed / new issues + score delta).

No commercial/SaaS layer in this build (workspaces, billing, SSO are deferred). No campaign/approval gates yet — just the asset → versions spine that those will plug into later.

---

### 1. New navigation & entry points

- New top-nav item **"Pre-Live"** alongside Dashboard / New Analysis / Bulk / Trends.
- `/prelive` — list of pre-live **Assets** (cards: thumbnail, latest version, latest score, # versions, last updated).
- `/prelive/new` — create a new pre-live Asset (brief intake + first Playbook link).
- `/prelive/asset/:assetId` — Asset detail: versions timeline, brief panel, latest QC, **"Add new version"** button.
- `/prelive/asset/:assetId/diff?from=v1&to=v2` — version diff view.
- Existing post-live screens are untouched.

### 2. Brief intake (form + optional PDF)

On `/prelive/new`:
- **Structured form** (always required, source of truth):
  - Campaign name, Product/business (reuse the 15-business taxonomy from `DeepReviewPanel`), Persona (auto-filled from business, editable), Channel (TV / YouTube pre-roll / Instagram Reel / Story / Bumper 6s / Web hero / Other), Aspect ratio (16:9 / 9:16 / 1:1 / 4:5), Target runtime (sec), Language(s), Key claims (chips), Mandatory disclaimers (chips), Notes.
- **Optional brief PDF upload** → parsed by an edge function using Lovable AI (Gemini 2.5 Flash) to **pre-fill** the form. User can edit any field before saving. PDF stored in a private `pre-live-briefs` bucket with signed URL access.

### 3. Playbook integration (offline source of truth)

Editors keep MP4s in Playbook; we never store the file ourselves.

- On Asset create / "Add new version", user pastes a **Playbook share URL** (e.g. `https://playbookhq.co/s/...` or `https://app.playbook.com/...`) plus a **version label** (defaults to `v{N+1}`) and optional **change notes** ("what's different from previous cut").
- New edge function **`resolve-playbook`** takes a Playbook URL and returns:
  - `directVideoUrl` (signed/public MP4 URL Playbook serves), `thumbnailUrl`, `title`, `durationSec` (best-effort).
  - Strategy ladder, in order:
    1. **Playbook public/share API** if available for the link type (preferred).
    2. **HTML scrape** of the share page for `<video src>`, `<meta property="og:video">`, embedded JSON manifests.
    3. **Firecrawl** fallback (already connected) to render the share page and extract the video URL.
    4. **Manual override**: user can paste the direct MP4 URL themselves if resolution fails.
- We pass the resolved direct URL to the existing **`deep-video-review`** function — Gemini Files API already accepts arbitrary signed URLs, so the AI engine is reused as-is.
- A small "Re-resolve" button on each version handles expired Playbook signed URLs (re-runs `resolve-playbook` and updates `video_url`).

### 4. Version model & data

Each Asset has 1..N Versions. Each Version owns one QC Task (reusing `qc_tasks` exactly as today, so issues, transcripts, deep-review, BucketScoreCard all work unchanged).

New tables:
- **`prelive_assets`** — `id`, `owner_id`, `campaign_name`, `business_key`, `persona`, `channel`, `aspect_ratio`, `target_runtime_sec`, `languages[]`, `key_claims[]`, `mandatory_disclaimers[]`, `notes`, `brief_pdf_path` (nullable), `latest_version_id` (nullable), `created_at`, `updated_at`.
- **`prelive_versions`** — `id`, `asset_id`, `version_label` (e.g. "v1"), `version_index` (int, for ordering & diffing), `playbook_url`, `resolved_video_url`, `resolved_thumbnail_url`, `duration_sec`, `change_notes`, `qc_task_id` (FK → `qc_tasks.id`), `status` (`resolving` / `analyzing` / `ready` / `failed`), `created_at`.
- RLS: owner can read/write own assets+versions; admins can read all. Same pattern as `qc_tasks`.
- New private storage bucket **`pre-live-briefs`** for brief PDFs with owner-scoped policies.

### 5. Run flow per version

1. User submits Playbook URL + version label.
2. Frontend creates `prelive_versions` row (`status: resolving`) + a `qc_tasks` row (mode flagged as pre-live via a new `source_kind` column on `qc_tasks`: `'live_url' | 'prelive_playbook'`, default `'live_url'`).
3. `resolve-playbook` edge fn populates `resolved_video_url` etc. on the version, then invokes `deep-video-review` with that URL plus the brief context (assembled into `pageContext`-shaped string so the existing prompt picks it up — no breaking change to the deep-review fn signature; just richer context).
4. Persona is taken from the Asset's brief (auto from business mapping, editable per-version).
5. Existing pipeline produces issues, bucket scores, key frames — Asset detail shows them via the same `BucketScoreCard` and issues list components from `TaskDetail.tsx`.

### 6. Version diff view

`/prelive/asset/:assetId/diff?from=v1&to=v2`:
- Header strip: thumbnails of both versions, overall score delta (e.g. **72 → 81 (+9)**), per-bucket deltas with up/down arrows.
- Three columns of issues:
  - **Fixed** (in v1, not in v2)
  - **Regressed** (worse severity in v2 vs v1, or reopened)
  - **New** (only in v2)
- Issue matching algorithm (deterministic, no extra AI call): hash on `(bucket, criterion, normalized_title)` with fuzzy title match (Levenshtein < 0.25) and timestamp window (±3s) as tie-breaker. Pure client-side over already-loaded issue lists from both tasks.
- "Open in Task" deep-link on each issue.

### 7. Asset detail page

- Left rail: brief summary (editable inline), Playbook source links per version.
- Main: vertical version timeline (v1, v2, v3 …) with per-version score chip + status. Click a version → opens its existing TaskDetail content inline (reuse the components, not the route).
- Top-right: **"Add new version"** button (paste Playbook URL → run).
- Compare selector: pick any two versions → opens diff view.

### 8. Reuse vs. new

**Reused as-is:** `deep-video-review` edge fn, `BucketScoreCard`, issue/transcript/comments/approval components, `qc_rubric`, persona taxonomy from `DeepReviewPanel`, RLS pattern, dark theme + tokens.

**New code:** routes above, `resolve-playbook` edge fn, `parse-brief-pdf` edge fn, two new tables + bucket, diff utility (`src/lib/version-diff.ts`), `PreLiveAssetCard`, `BriefForm`, `PlaybookLinkInput`, `VersionTimeline`, `VersionDiffView`.

### 9. Out of scope for this build (called out so we don't drift)

- Campaign rollups, agency leaderboards, approval gates (Brand/Compliance sign-off), notifications, threaded comments, immutable audit log, SSO/billing, ffmpeg loudness/color deterministic checks, multi-language disclaimer dictionary. These stay on the roadmap and slot cleanly on top of the Asset → Version spine.

---

### Technical notes (for engineering)

- **Playbook resolution risk:** Playbook share pages may require auth or use rotating signed URLs. We mitigate with the 4-step ladder (API → HTML → Firecrawl → manual paste). If we hit consistent auth walls, a follow-up build can add a Playbook OAuth connection or accept an API token via `secrets`. We will validate against 2–3 real Playbook links you provide before locking the resolver.
- **Pre-live flag on `qc_tasks`:** add nullable `source_kind` + nullable `prelive_version_id` so existing dashboards keep working and we can filter pre-live out of the post-live Dashboard if desired.
- **Brief context to AI:** assemble a structured block (channel, aspect, runtime, claims, disclaimers, change notes) and pass it as `pageContext` to `deep-video-review`. Prompt is updated to weight these as "intent ground truth" — improves precision, especially for disclaimer/claims violations.
- **Diff stays client-side**: cheap, instant, no AI cost; both versions' issues are already in cache.

### Open assumption to confirm during build

- I'll validate the Playbook URL pattern(s) you actually use against `resolve-playbook`. If the share page is fully gated behind login, we'll either ask you for a Playbook API token (stored as a runtime secret) or fall back to manual direct-URL paste for those cases — your call when we hit the first gated link.
