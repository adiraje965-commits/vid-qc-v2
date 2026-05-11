export interface BusinessOption {
  key: string;
  label: string;
  persona: string;
}

export const BUSINESS_OPTIONS: BusinessOption[] = [
  { key: "personal-loan", label: "Personal Loan", persona: "First-time Bajaj Finance customer evaluating a personal loan" },
  { key: "two-wheeler-loan", label: "Two Wheeler Loan", persona: "Young salaried buyer comparing two-wheeler loan options on Bajaj Finance" },
  { key: "new-car-loan", label: "New Car Loan", persona: "First-time car buyer evaluating a Bajaj Finance new car loan" },
  { key: "used-car-loan", label: "Used Car Loan", persona: "Budget-conscious buyer evaluating a Bajaj Finance used car loan" },
  { key: "consumer-durable-loan", label: "Consumer Durable Loan (Electronics)", persona: "Shopper considering No Cost EMI on electronics via Bajaj Finance Consumer Durable Loan" },
  { key: "business-loan", label: "Business Loan", persona: "SME owner evaluating a Bajaj Finance unsecured business loan for working capital" },
  { key: "professional-loan", label: "Professional Loan", persona: "Self-employed doctor/CA evaluating a Bajaj Finance professional loan" },
  { key: "gold-loan", label: "Gold Loan", persona: "Customer needing quick liquidity evaluating a Bajaj Finance gold loan" },
  { key: "home-loan", label: "Home Loan", persona: "Mid-career family evaluating a Bajaj Housing Finance home loan" },
  { key: "loan-against-securities", label: "Loan Against Securities", persona: "Investor exploring a Bajaj Finance loan against shares/mutual funds without liquidating holdings" },
  { key: "tractor-finance", label: "Tractor Finance", persona: "Farmer evaluating a Bajaj Finance tractor loan for farm productivity" },
  { key: "insurance", label: "Insurance", persona: "Policy seeker comparing insurance plans on Bajaj Markets" },
  { key: "demat", label: "DEMAT", persona: "New retail investor opening a Bajaj Broking DEMAT account" },
  { key: "mutual-fund", label: "Mutual Fund", persona: "First-time SIP investor exploring mutual funds on Bajaj Finserv" },
  { key: "fd", label: "Fixed Deposit (FD)", persona: "Risk-averse saver comparing Bajaj Finance Fixed Deposit rates" },
];

export const CHANNEL_OPTIONS = ["TV", "YouTube pre-roll", "YouTube Bumper 6s", "Instagram Reel", "Instagram Story", "Web hero", "Other"];
export const ASPECT_OPTIONS = ["16:9", "9:16", "1:1", "4:5"];
export const LANGUAGE_OPTIONS = ["English", "Hindi", "Marathi", "Tamil", "Telugu", "Bengali", "Kannada", "Malayalam", "Gujarati", "Punjabi"];

export interface BriefDraft {
  campaign_name: string;
  business_key: string;
  persona: string;
  channel: string;
  aspect_ratio: string;
  target_runtime_sec: number | null;
  languages: string[];
  key_claims: string[];
  mandatory_disclaimers: string[];
  notes: string;
}

export const EMPTY_BRIEF: BriefDraft = {
  campaign_name: "",
  business_key: BUSINESS_OPTIONS[0].key,
  persona: BUSINESS_OPTIONS[0].persona,
  channel: "YouTube pre-roll",
  aspect_ratio: "16:9",
  target_runtime_sec: 30,
  languages: ["English"],
  key_claims: [],
  mandatory_disclaimers: [],
  notes: "",
};

export function briefToContextString(b: BriefDraft, changeNotes?: string | null): string {
  const lines = [
    `CAMPAIGN: ${b.campaign_name || "(untitled)"}`,
    `BUSINESS: ${BUSINESS_OPTIONS.find((x) => x.key === b.business_key)?.label ?? b.business_key}`,
    `CHANNEL: ${b.channel}  ASPECT: ${b.aspect_ratio}  TARGET RUNTIME: ${b.target_runtime_sec ?? "?"}s`,
    `LANGUAGES: ${b.languages.join(", ") || "—"}`,
    b.key_claims.length ? `KEY CLAIMS:\n- ${b.key_claims.join("\n- ")}` : "",
    b.mandatory_disclaimers.length ? `MANDATORY DISCLAIMERS:\n- ${b.mandatory_disclaimers.join("\n- ")}` : "",
    b.notes ? `BRIEF NOTES:\n${b.notes}` : "",
    changeNotes ? `VERSION CHANGE NOTES:\n${changeNotes}` : "",
    "",
    "This is a PRE-LIVE draft cut. Treat the brief above as ground-truth intent. Penalize any deviation from declared claims, missing mandatory disclaimers, wrong aspect ratio, or runtime that exceeds the target by more than 10%.",
  ];
  return lines.filter(Boolean).join("\n");
}
