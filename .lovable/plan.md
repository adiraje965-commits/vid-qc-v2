# Step-by-Step User Guide Deck — Bajaj Video QC Platform

A concise ~9-slide PPTX (.pptx) covering both executive context and end-user steps, with screenshots captured live from the running preview.

## Deck Outline

1. **Title** — Bajaj Video QC Platform · Step-by-step user guide
2. **What it is & who it's for** — 3 bullets exec context, 3 bullets user benefit
3. **Step 1 — Start a New Analysis** — Paste landing page or direct video URL → Scan *(screenshot: New Analysis page)*
4. **Step 2 — Pick the video** — Review detected videos, run QC on one or all *(screenshot: detected video list)*
5. **Step 3 — Open the Task** — Dashboard → click into a task to see overall score, issues, transcript *(screenshot: Task Detail header)*
6. **Step 4 — Run Deep Review** — Pick Business persona → "Run Deep Review" (Gemini watches the full video) *(screenshot: Deep Review panel)*
7. **Step 5 — Read the 4 Score Buckets** — Technical / Brand / Strategic / Contextual, expandable sub-criteria with rationale *(screenshot: BucketScoreCard expanded)*
8. **Step 6 — Act on findings** — Filter issues by severity, comment, approve/reject, export *(screenshot: issues list + approval panel)*
9. **Standards & Tips** — ABCD, EBU R128, BT.709, RBI/SEBI/IRDAI, ASCI, WCAG 2.2 + 3 quick tips

## Visual style

- Dark navy + Bajaj blue accents, clean sans-serif (Calibri/Arial)
- One screenshot per step slide (right side), numbered step + 3-4 bullets (left)
- Footer: "Bajaj Video QC · v2"

## Technical Approach

1. Use browser tool to navigate the preview and capture screenshots of: Dashboard, New Analysis, detected-videos list, Task Detail (overall score), Deep Review panel, BucketScoreCard expanded, issues + approval panel.
2. Save PNGs to `/tmp/qc-shots/`.
3. Generate `Bajaj_VideoQC_User_Guide.pptx` with `pptxgenjs` (16:9, embedded base64 images).
4. QA: convert to PDF via LibreOffice → pdftoppm → inspect each slide image, fix issues, re-render.
5. Deliver via `<lov-artifact>` from `/mnt/documents/`.

No code changes to the app.
