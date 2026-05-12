# Pre-Live navigation audit + Export QC analysis report

## Part 1 — Navigation audit (Pre-Live)

Quick walk-through of each screen's links/buttons. Findings:

- `/prelive` (List) → cards link to `/prelive/asset/:id` ✓; "New" → `/prelive/new` ✓.
- `/prelive/new` → "Back" uses `nav(-1)` ✓; "Cancel" → `/prelive` ✓; on success → `/prelive/asset/:id` ✓.
- `/prelive/asset/:id` → "Back" → `/prelive` ✓; per-version "Open" → `/task/:qc_task_id` ✓; "Diff" → `/prelive/asset/:id/diff?from=&to=` ✓.
- `/prelive/asset/:id/diff` → "Back" → `/prelive/asset/:id` ✓; "Open vN" → `/task/:qc_task_id` ✓.
- `/task/:id` (when opened from pre-live) → "Back to video list for this URL" routes to `/new?url=…` which is the LIVE flow, not back to the pre-live asset.

Fix: when a task has `source_kind === "prelive_playbook"` and a `prelive_version_id`, change the back link to `/prelive/asset/<asset_id>` (lookup the asset id via the version). Keep current behavior for live tasks.

## Part 2 — Export analysis report

### Recommended format: PDF
A QC report needs to be shared with editors/marketing/compliance who won't run JSON or CSV. PDF is:
- Self-contained, brand-styleable, viewable everywhere
- Preserves layout: scores, severity counts, issue list with timestamps, key frames thumbnail strip, summary, brief context (pre-live)
- One click → email/Slack-friendly

Secondary export: **JSON** download (raw issues + scores) for power users / archival. Small add, same button as a dropdown.

(CSV considered — fine for issues table only, but loses scores/summary/keyframes context. Skipped as primary.)

### Where the export lives
- **Task detail (`/task/:id`)** — top-right of the header section, next to the score ring. Used by both Live and Pre-Live tasks.
- **Pre-Live asset (`/prelive/asset/:id`)** — per-version row gets an "Export" button next to "Open". Also a top-level "Export latest" in the header.
- **Pre-Live diff** — single "Export diff PDF" button (fixed vs regressed vs new + score deltas).

### What's in the PDF
1. Header: campaign / page title, URL, timestamp, overall score badge
2. Score buckets (Technical / Brand / Strategic / Contextual) with weights
3. Severity counts (C/H/M/L)
4. Analysis summary + customer intent + topic match
5. Issues table grouped by bucket — severity, timestamp, title, description, suggested fix
6. Key frames list (timestamp + label + severity)
7. Pre-Live only: brief context (persona, claims, disclaimers, change notes), version label
8. Diff variant: from→to scores with deltas, Fixed/Regressed/New issue lists

### Technical approach
- Client-side PDF using `jspdf` + `jspdf-autotable` (no server round-trip, no extra cost, works offline). Already-fetched task/issues data is reused.
- New file `src/lib/qc-export.ts` exporting:
  - `exportTaskPdf(task, issues, opts?)`
  - `exportTaskJson(task, issues)`
  - `exportDiffPdf(from, to, fromTask, toTask, diff)`
- New tiny component `src/components/ExportMenu.tsx` — dropdown (PDF / JSON) using existing `dropdown-menu` + `Button`.
- Wire into `TaskDetail.tsx`, `PreLiveAsset.tsx`, `PreLiveDiff.tsx`.
- Filename convention: `qc-<page_title-slug>-<yyyy-mm-dd>.pdf`.

### Files touched
- New: `src/lib/qc-export.ts`, `src/components/ExportMenu.tsx`
- Edit: `src/pages/TaskDetail.tsx` (back link fix + export menu)
- Edit: `src/pages/PreLiveAsset.tsx` (per-version + header export)
- Edit: `src/pages/PreLiveDiff.tsx` (export diff)
- Add deps: `jspdf`, `jspdf-autotable`

No backend / RLS / schema changes.
