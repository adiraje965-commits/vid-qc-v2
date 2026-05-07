# Robust QC Rubric — Sub-criteria within existing 4 buckets

Keep the current Technical / Brand / Strategic / Contextual top-level cards, but score each one on 5–6 named sub-criteria drawn from global production guidelines + Indian financial-services regulation. Every sub-criterion has a weight, a 0–100 score, a short rationale from the model, and any issues link back to it. Each bucket card on the task page becomes expandable to reveal sub-scores and per-criterion fixes.

## The rubric

### Technical (weight 25%) — production craft
Standards: **EBU R128**, **ITU-R BT.709**, **IAB/MRC video ad delivery**.
- Audio loudness & dynamics — target −23 LUFS ±1 (broadcast) / −14 LUFS (web), true-peak ≤ −1 dBTP, no clipping
- Exposure, white balance & color — BT.709 gamut, no crushed blacks/blown highlights, consistent WB across cuts
- Framing, composition & camera stability — rule-of-thirds, headroom, no unintended shake, safe-area respected
- Edit craft — cut rhythm, no jump cuts, clean L-cuts/J-cuts, transitions purposeful
- Encoding & delivery — resolution ≥ source, bitrate appropriate, correct aspect (16:9 / 9:16 / 1:1), no macroblocking
- Sound design — music bed −18 to −22 LU below VO, SFX present where needed, no room tone gaps

### Brand (weight 30%) — Bajaj brand & creative effectiveness
Standards: **Google ABCD — Branding pillar**, internal Bajaj brand book cues.
- Logo presence & timing — visible in first 5s, end-frame lockup, correct clear-space
- Color & typography fidelity — Bajaj blue/red palette, approved typefaces, no off-brand fonts
- Brand mention cadence — verbal + on-screen brand mentions distributed (not just end)
- Tone of voice — confident, simple, customer-first; no jargon or aggressive claims
- Visual identity system — iconography, motion language, supers style match brand kit
- Talent & wardrobe appropriateness — represents target customer, no conflicting brand wear

### Strategic (weight 20%) — performance & narrative
Standards: **Google ABCD — Attention, Connection, Direction**.
- Hook strength (first 3s) — visual + audio hook, problem/promise framed fast
- Narrative arc & pacing — clear setup→benefit→proof→CTA, no dead air >2s
- Single-minded message — one core proposition, not a feature dump
- Emotional connection — relatable scenario, faces, human moments
- Call-to-action clarity — verbal CTA + on-screen CTA + URL/app name; placed in last 5s and ideally mid-roll
- Platform-fit — duration, aspect, captions-on-by-default for the intended channel (YouTube / Meta / CTV / in-app)

### Contextual (weight 25%) — page match, compliance, accessibility
Standards: **RBI MITC / Fair Practices Code**, **ASCI Code**, **SEBI MF ads**, **IRDAI insurance ads**, **WCAG 2.2**.
- Page–video topic match — video subject matches the landing page's product (uses existing `topic_match_score`)
- Persona relevance — addresses the selected business persona's intent and objections
- Mandatory disclaimers — APR/representative example (loans), "Mutual fund investments are subject to market risks…" (MF), "Insurance is the subject matter of solicitation" (insurance), T&C apply, MITC reference — present, legible ≥4s, ≥14px equiv
- Truthful claims & substantiation — no "lowest", "instant", "guaranteed" without proof; ASCI-compliant
- Accessibility — burned-in or sidecar captions, caption accuracy, contrast ratio ≥4.5:1 on supers, no >3 Hz flashing, audio-described key visuals
- Risk & target-audience fit — no misleading affordability cues, no targeting minors for credit, responsible-lending tone

## Scoring math

```
bucket_score   = Σ (sub_score_i * sub_weight_i)        // weights sum to 1 inside a bucket
penalty        = Σ severity_weight per linked issue     // critical 25 / high 15 / medium 8 / low 3
adjusted_sub   = max(0, sub_score - min(40, penalty*0.4))
overall_score  = 0.25*Tech + 0.30*Brand + 0.20*Strat + 0.25*Ctx
```
Each issue carries `bucket` **and** new `criterion` (e.g. `technical.audio_loudness`) so the UI can attribute fixes precisely.

## What to build

### Backend — `supabase/functions/deep-video-review/index.ts`
- Replace the `bucket_scores` schema with a nested object: each bucket → `{ overall, criteria: { <key>: { score, rationale } } }`.
- Update the system prompt to instruct Gemini to score every listed sub-criterion against the cited standard, cite the standard in the rationale (e.g. "EBU R128: integrated loudness measured at −9 LUFS, 14 LU above target"), and tag each issue with `criterion`.
- Update `computeOverall` to fold sub-criteria → bucket → overall using the weights above.
- Persist sub-scores as JSONB.

### DB — single migration
- `qc_tasks.bucket_breakdown jsonb default '{}'::jsonb` — stores the 4 buckets × sub-criteria scores + rationales.
- `qc_issues.criterion text` — nullable, e.g. `brand.logo_presence`.
- (No RLS changes; existing policies cover both columns.)

### Frontend
- `src/lib/qc-rubric.ts` (new) — single source of truth: bucket → criteria list, weights, labels, standard citation, default-empty shape. Imported by both UI and edge function (duplicated in the edge function file since edge functions can't import from `src/`).
- `src/lib/qc-types.ts` — add `BucketBreakdown` type and `criterion` on `QcIssue`.
- `src/components/BucketScoreCard.tsx` (new) — expandable card: header shows bucket score + chevron; expanded shows each sub-criterion as a row with mini-bar, score, the cited standard as a small chip, and a "View N issues" link that filters the issues panel by `criterion`.
- `src/pages/TaskDetail.tsx` — replace the four flat score tiles with `BucketScoreCard` components; keep the overall score header unchanged; add `criterion` filter wiring on the issues panel.
- `DeepReviewPanel.tsx` — unchanged.

### Out of scope
- No changes to scrape / transcript / live-capture flows.
- No changes to bulk upload or trends pages (they continue to read `overall_score`).
- No new AI model — still Gemini 2.5 Pro via the existing edge function.

## Acceptance
- Re-running Deep Review on an existing task populates `bucket_breakdown` with all 4 buckets × their sub-criteria, each with a 0–100 score and a 1–2 sentence rationale that cites the relevant standard.
- Expanding any bucket card on the task page shows the sub-scores and lets the user click through to the issues that drove the deduction.
- Overall score still renders and is within ±2 of the previous formula on a re-run of the same task (sanity check that weighting didn't break baselines).
