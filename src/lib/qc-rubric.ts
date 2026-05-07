// Single source of truth for the QC rubric.
// Used by the UI and DUPLICATED inside supabase/functions/deep-video-review/index.ts
// (edge functions cannot import from src/). Keep the two in sync.

export type BucketKey = "technical" | "brand" | "strategic" | "contextual";

export interface CriterionDef {
  key: string;          // e.g. "audio_loudness"
  label: string;        // human label
  weight: number;       // 0-1, weights inside a bucket sum to 1
  standard: string;     // short citation chip
  guidance: string;     // 1-line description used in the model prompt
}

export interface BucketDef {
  key: BucketKey;
  label: string;
  weight: number;       // bucket weight in overall score (sums to 1)
  blurb: string;
  criteria: CriterionDef[];
}

export const RUBRIC: BucketDef[] = [
  {
    key: "technical",
    label: "Technical",
    weight: 0.25,
    blurb: "Production craft — audio, image, edit, encoding.",
    criteria: [
      { key: "audio_loudness", label: "Audio loudness & dynamics", weight: 0.20, standard: "EBU R128",
        guidance: "Integrated loudness near -14 LUFS (web) / -23 LUFS (broadcast); true-peak <= -1 dBTP; no clipping." },
      { key: "exposure_color", label: "Exposure, WB & color", weight: 0.18, standard: "ITU-R BT.709",
        guidance: "Rec.709 gamut, no crushed blacks/blown highlights, consistent white balance across cuts." },
      { key: "framing_stability", label: "Framing & camera stability", weight: 0.15, standard: "Cinematography craft",
        guidance: "Rule of thirds, headroom, safe-area respected, no unintended shake." },
      { key: "edit_craft", label: "Edit craft", weight: 0.17, standard: "Editing craft",
        guidance: "Cut rhythm, no jump cuts, clean L/J cuts, transitions purposeful." },
      { key: "encoding_delivery", label: "Encoding & delivery", weight: 0.15, standard: "IAB/MRC video ad delivery",
        guidance: "Adequate resolution & bitrate, correct aspect (16:9 / 9:16 / 1:1), no macroblocking." },
      { key: "sound_design", label: "Sound design", weight: 0.15, standard: "EBU R128",
        guidance: "Music bed -18 to -22 LU below VO; SFX present where needed; no awkward room-tone gaps." },
    ],
  },
  {
    key: "brand",
    label: "Brand",
    weight: 0.30,
    blurb: "Bajaj brand fidelity & creative effectiveness.",
    criteria: [
      { key: "logo_presence", label: "Logo presence & timing", weight: 0.20, standard: "Google ABCD — Branding",
        guidance: "Logo visible in first 5s, end-frame lockup, correct clear-space." },
      { key: "color_typography", label: "Color & typography fidelity", weight: 0.18, standard: "Bajaj brand book",
        guidance: "Bajaj blue/red palette, approved typefaces, no off-brand fonts." },
      { key: "brand_mention_cadence", label: "Brand mention cadence", weight: 0.15, standard: "Google ABCD — Branding",
        guidance: "Verbal + on-screen brand mentions distributed across the video, not clustered at the end." },
      { key: "tone_of_voice", label: "Tone of voice", weight: 0.17, standard: "Bajaj brand book",
        guidance: "Confident, simple, customer-first; no jargon, no aggressive claims." },
      { key: "visual_identity", label: "Visual identity system", weight: 0.15, standard: "Bajaj brand book",
        guidance: "Iconography, motion language and supers style match the brand kit." },
      { key: "talent_wardrobe", label: "Talent & wardrobe", weight: 0.15, standard: "Casting standards",
        guidance: "Talent represents the target customer; wardrobe has no conflicting brands." },
    ],
  },
  {
    key: "strategic",
    label: "Strategic",
    weight: 0.20,
    blurb: "Performance & narrative craft.",
    criteria: [
      { key: "hook_strength", label: "Hook strength (first 3s)", weight: 0.22, standard: "Google ABCD — Attention",
        guidance: "Strong visual + audio hook; problem or promise framed within 3 seconds." },
      { key: "narrative_pacing", label: "Narrative arc & pacing", weight: 0.18, standard: "Storytelling craft",
        guidance: "Setup → benefit → proof → CTA; no dead air > 2 seconds." },
      { key: "single_minded_message", label: "Single-minded message", weight: 0.15, standard: "Google ABCD — Connection",
        guidance: "One core proposition, not a feature dump." },
      { key: "emotional_connection", label: "Emotional connection", weight: 0.15, standard: "Google ABCD — Connection",
        guidance: "Relatable scenario, faces, human moments." },
      { key: "cta_clarity", label: "CTA clarity & placement", weight: 0.18, standard: "Google ABCD — Direction",
        guidance: "Verbal + on-screen CTA with URL/app name; placed in last 5s and ideally mid-roll." },
      { key: "platform_fit", label: "Platform-fit", weight: 0.12, standard: "Platform best practices",
        guidance: "Duration, aspect, captions-on-by-default match the intended channel (YouTube/Meta/CTV/in-app)." },
    ],
  },
  {
    key: "contextual",
    label: "Contextual",
    weight: 0.25,
    blurb: "Page match, compliance, accessibility.",
    criteria: [
      { key: "topic_match", label: "Page–video topic match", weight: 0.18, standard: "Landing-page relevance",
        guidance: "Video subject matches the landing page's product." },
      { key: "persona_relevance", label: "Persona relevance", weight: 0.15, standard: "Customer-journey fit",
        guidance: "Addresses the selected business persona's intent and likely objections." },
      { key: "mandatory_disclaimers", label: "Mandatory disclaimers", weight: 0.22, standard: "RBI / SEBI / IRDAI / ASCI",
        guidance: "APR / representative example (loans), 'Mutual fund investments are subject to market risks…' (MF), 'Insurance is the subject matter of solicitation' (insurance), T&C apply, MITC reference — present, legible >=4s, >=14px equivalent." },
      { key: "truthful_claims", label: "Truthful claims & substantiation", weight: 0.17, standard: "ASCI Code",
        guidance: "No 'lowest', 'instant', 'guaranteed' without substantiation; ASCI-compliant." },
      { key: "accessibility", label: "Accessibility", weight: 0.16, standard: "WCAG 2.2",
        guidance: "Burned-in or sidecar captions, accurate; contrast ratio >=4.5:1 on supers; no >3 Hz flashing." },
      { key: "audience_fit", label: "Risk & target-audience fit", weight: 0.12, standard: "RBI Fair Practices Code",
        guidance: "No misleading affordability cues, no targeting minors for credit, responsible-lending tone." },
    ],
  },
];

export const BUCKET_WEIGHTS: Record<BucketKey, number> = Object.fromEntries(
  RUBRIC.map((b) => [b.key, b.weight]),
) as Record<BucketKey, number>;

export interface CriterionScore {
  score: number;       // 0-100 raw score from the model
  rationale: string;   // 1-2 sentences citing the standard
}

export interface BucketBreakdownEntry {
  overall: number;                                  // weighted from criteria
  criteria: Record<string, CriterionScore>;         // keyed by criterion.key
}

export type BucketBreakdown = Partial<Record<BucketKey, BucketBreakdownEntry>>;

export function getBucket(key: BucketKey): BucketDef {
  return RUBRIC.find((b) => b.key === key)!;
}

export function getCriterion(bucket: BucketKey, criterionKey: string): CriterionDef | undefined {
  return getBucket(bucket).criteria.find((c) => c.key === criterionKey);
}

// Compute weighted bucket score from sub-criteria.
export function computeBucketScore(bucket: BucketKey, criteria: Record<string, CriterionScore> | undefined): number {
  if (!criteria) return 0;
  const def = getBucket(bucket);
  let sum = 0;
  let wsum = 0;
  for (const c of def.criteria) {
    const v = criteria[c.key];
    if (v && typeof v.score === "number") {
      sum += v.score * c.weight;
      wsum += c.weight;
    }
  }
  return wsum > 0 ? Math.round(sum / wsum) : 0;
}
