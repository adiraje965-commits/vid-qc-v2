export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface QcTask {
  id: string;
  url: string;
  video_url: string | null;
  thumbnail_url: string | null;
  page_title: string | null;
  page_markdown: string | null;
  customer_intent: string | null;
  topic_match_score: number | null;
  status: "processing" | "completed" | "failed";
  overall_score: number | null;
  technical_score: number | null;
  brand_score: number | null;
  strategic_score: number | null;
  contextual_score: number | null;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  key_frames: KeyFrame[];
  transcript: TranscriptSegment[];
  transcript_status: "pending" | "ready" | "unsupported_source" | "failed" | null;
  media_url: string | null;
  media_kind: "mp4" | "hls" | null;
  analysis_summary: string | null;
  error_message: string | null;
  owner_id?: string | null;
  tags?: string[];
  approval_status?: string;
  approval_note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KeyFrame {
  timestamp_sec: number;
  label: string;
  suggested_fix?: string;
  severity: Severity;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface QcIssue {
  id: string;
  task_id: string;
  bucket: "technical" | "brand" | "strategic" | "contextual";
  criterion?: string | null;
  severity: Severity;
  timestamp_sec: number | null;
  title: string;
  description: string | null;
  suggested_fix: string | null;
  created_at: string;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info",
};

export const BUCKET_LABEL = {
  technical: "Technical",
  brand: "Brand",
  strategic: "Strategic",
  contextual: "Contextual",
} as const;

export function scoreColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-score-good";
  if (score >= 60) return "text-score-warn";
  return "text-score-bad";
}

export function severityClass(s: Severity) {
  return {
    critical: "bg-severity-critical/15 text-severity-critical border-severity-critical/30",
    high: "bg-severity-high/15 text-severity-high border-severity-high/30",
    medium: "bg-severity-medium/15 text-severity-medium border-severity-medium/30",
    low: "bg-severity-low/15 text-severity-low border-severity-low/30",
    info: "bg-severity-info/15 text-severity-info border-severity-info/30",
  }[s];
}
