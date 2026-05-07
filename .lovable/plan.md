# Persona Selector for Deep Video Review

Replace the single prefilled persona text input in `DeepReviewPanel` with a **business-line dropdown + editable text field** combo, so reviewers can quickly switch personas across all Bajaj businesses while still being able to fine-tune the wording.

## UX

- New compact `Select` dropdown labeled **Business** placed before the existing Persona input.
- Selecting a business overwrites the Persona text with a sensible default (e.g. "First-time Bajaj Finance customer evaluating a [business]").
- Persona text remains fully editable after selection (free typing doesn't reset the dropdown).
- Default selection on load: **Personal Loan** (matches today's behavior).

## Business options

Personal Loan · Two Wheeler Loan · New Car Loan · Used Car Loan · Consumer Durable Loan (electronics) · Business Loan · Professional Loan · Gold Loan · Home Loan · Loan Against Securities · Tractor Finance · Insurance · DEMAT · Mutual Fund · Fixed Deposit (FD)

Each maps to a persona template, e.g.:
- Personal Loan → "First-time Bajaj Finance customer evaluating a personal loan"
- Two Wheeler Loan → "Young salaried buyer comparing two-wheeler loan options on Bajaj Finance"
- Home Loan → "Mid-career family evaluating a Bajaj Housing Finance home loan"
- DEMAT → "New retail investor opening a Bajaj Broking DEMAT account"
- FD → "Risk-averse saver comparing Bajaj Finance Fixed Deposit rates"
- …(similar one-liners for each business)

## Technical

- File: `src/components/DeepReviewPanel.tsx` only. No backend / edge function changes — `persona` continues to be sent as a free-text string in the existing `deep-video-review` invoke body.
- Use existing shadcn `Select` (`@/components/ui/select`) and current `<input>` element; keep semantic tokens, no custom colors.
- Local state: add `business` (string key) alongside existing `persona` state. `onValueChange` updates both `business` and `persona` (to the template). Manual edits to the input only update `persona`.
- Layout: stack on narrow widths, inline on wider — `flex flex-wrap items-center gap-2`. Label styling matches the existing "Persona" label.

## Out of scope

- No DB schema changes, no edge function changes, no changes to other panels or QC logic.
