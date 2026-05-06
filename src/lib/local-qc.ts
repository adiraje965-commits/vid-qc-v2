import type { DetectedVideo, ScrapeResult } from "./qc-client";
import type { KeyFrame, QcIssue, QcTask, TranscriptSegment } from "./qc-types";

const TASKS_KEY = "vid-qc:local-tasks";
const ISSUES_KEY = "vid-qc:local-issues";
const CHANGE_EVENT = "vid-qc:local-change";

type TaskPatch = Partial<QcTask>;

function now() {
  return new Date().toISOString();
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function cleanText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function issueId() {
  return `local_issue_${crypto.randomUUID()}`;
}

function makeIssue(taskId: string, bucket: QcIssue["bucket"], severity: QcIssue["severity"], title: string, description: string, suggested_fix: string, timestamp_sec: number | null): QcIssue {
  return {
    id: issueId(),
    task_id: taskId,
    bucket,
    severity,
    timestamp_sec,
    title,
    description,
    suggested_fix,
    created_at: now(),
  };
}

function inferIntent(pageTitle: string | null, markdown: string) {
  const source = cleanText(`${pageTitle ?? ""} ${markdown}`).slice(0, 500).toLowerCase();
  if (/personal loan|loan/.test(source)) return "Compare loan benefits and submit a lead for financing.";
  if (/card|emi card|credit/.test(source)) return "Understand card eligibility, benefits, and application next steps.";
  if (/insurance|policy/.test(source)) return "Evaluate protection benefits and decide whether to enquire.";
  if (/fd|fixed deposit|investment/.test(source)) return "Compare savings returns and choose an investment option.";
  return "Understand the promoted financial product and decide whether to continue.";
}

function buildTranscriptDraft(scraped: ScrapeResult, video: DetectedVideo): TranscriptSegment[] {
  const snippets = cleanText(scraped.pageMarkdown)
    .split(/(?:\.|\n|•|-)\s+/)
    .map((line) => cleanText(line))
    .filter((line) => line.length > 28 && line.length < 180)
    .slice(0, 6);

  if (!snippets.length) return [];

  return snippets.map((text, index) => ({
    start: index * 5,
    end: index * 5 + 4.5,
    text,
    speaker: video.type === "file" ? "Audio copy draft" : "Page copy draft",
  }));
}

function buildAnalysis(taskId: string, scraped: ScrapeResult, video: DetectedVideo, complianceCheck: boolean, fallbackReason?: string) {
  const markdown = cleanText(scraped.pageMarkdown);
  const pageTitle = scraped.pageTitle ?? "Untitled page";
  const videoTypePenalty = video.type === "other" ? 12 : video.type === "youtube" || video.type === "vimeo" ? 8 : 0;
  const contextSignal = markdown.length > 800 ? 0 : 10;
  const complianceSignal = complianceCheck && !/(t&c|terms|conditions apply|rbi|disclaimer)/i.test(markdown) ? 14 : 0;
  const fallbackPenalty = fallbackReason ? 6 : 0;

  const issues: QcIssue[] = [
    makeIssue(
      taskId,
      "technical",
      video.type === "other" ? "high" : "medium",
      video.type === "other" ? "Video source is not directly inspectable" : "Automated media inspection used fallback mode",
      fallbackReason || "The cloud QC services could not fully inspect frames/audio from this browser session.",
      "Connect Firecrawl, ElevenLabs, and Lovable AI in the hosted project, or paste a direct .mp4/.m3u8 source in the task transcript panel.",
      0,
    ),
    makeIssue(
      taskId,
      "contextual",
      contextSignal ? "medium" : "low",
      "Landing page context needs final human review",
      `The video was matched against "${pageTitle}" using available page text and detected video metadata.`,
      "Review the opening claim, offer name, eligibility language, and CTA against the landing page above.",
      5,
    ),
  ];

  if (complianceSignal) {
    issues.push(makeIssue(
      taskId,
      "brand",
      "high",
      "Mandatory disclaimer not visible in detected page copy",
      "The available page text did not include T&C, conditions apply, RBI, or similar legal disclaimer language.",
      "Add or verify required legal/disclaimer text in the final video frame and landing page area.",
      25,
    ));
  }

  const technical = clampScore(82 - videoTypePenalty - fallbackPenalty);
  const brand = clampScore(84 - complianceSignal - fallbackPenalty);
  const strategic = clampScore(78 - fallbackPenalty);
  const contextual = clampScore(86 - contextSignal - fallbackPenalty);
  const overall = clampScore(technical * 0.25 + brand * 0.30 + strategic * 0.20 + contextual * 0.25);
  const counts = {
    critical: issues.filter((i) => i.severity === "critical").length,
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
  };
  const keyFrames: KeyFrame[] = [
    { timestamp_sec: 0, label: "Opening hook and brand frame", severity: "info" },
    { timestamp_sec: 5, label: "Offer and landing page topic match", severity: contextSignal ? "medium" : "low", suggested_fix: "Compare spoken claim with the page headline and product name." },
    { timestamp_sec: 25, label: "Compliance and CTA check", severity: complianceSignal ? "high" : "info", suggested_fix: "Verify disclaimer and CTA visibility before publishing." },
  ];

  return { issues, scores: { technical, brand, strategic, contextual, overall }, counts, keyFrames };
}

export function isLocalId(id: string | null | undefined) {
  return !!id && id.startsWith("local_");
}

export function listLocalTasks(): QcTask[] {
  return readJson<QcTask[]>(TASKS_KEY, []).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

export function listLocalIssues(taskId?: string): QcIssue[] {
  const issues = readJson<QcIssue[]>(ISSUES_KEY, []);
  return taskId ? issues.filter((issue) => issue.task_id === taskId) : issues;
}

export function getLocalTask(id: string) {
  return listLocalTasks().find((task) => task.id === id) ?? null;
}

function saveTask(task: QcTask) {
  const tasks = listLocalTasks().filter((item) => item.id !== task.id);
  writeJson(TASKS_KEY, [task, ...tasks].slice(0, 300));
}

function saveIssues(taskId: string, issues: QcIssue[]) {
  const current = listLocalIssues().filter((issue) => issue.task_id !== taskId);
  writeJson(ISSUES_KEY, [...current, ...issues]);
}

export function patchLocalTask(id: string, patch: TaskPatch) {
  const existing = getLocalTask(id);
  if (!existing) return null;
  const next = { ...existing, ...patch, updated_at: now() };
  saveTask(next);
  return next;
}

export function createLocalTaskForVideo(
  pageUrl: string,
  video: DetectedVideo,
  scraped: ScrapeResult,
  complianceCheck: boolean,
  fallbackReason?: string,
) {
  const id = `local_${crypto.randomUUID()}`;
  const transcriptDraft = buildTranscriptDraft(scraped, video);
  const analysis = buildAnalysis(id, scraped, video, complianceCheck, fallbackReason);
  const task: QcTask = {
    id,
    url: pageUrl,
    video_url: video.url || null,
    thumbnail_url: video.thumbnail ?? scraped.ogImage,
    page_title: scraped.pageTitle,
    page_markdown: scraped.pageMarkdown,
    customer_intent: inferIntent(scraped.pageTitle, scraped.pageMarkdown),
    topic_match_score: analysis.scores.contextual,
    status: "completed",
    overall_score: analysis.scores.overall,
    technical_score: analysis.scores.technical,
    brand_score: analysis.scores.brand,
    strategic_score: analysis.scores.strategic,
    contextual_score: analysis.scores.contextual,
    critical_count: analysis.counts.critical,
    high_count: analysis.counts.high,
    medium_count: analysis.counts.medium,
    low_count: analysis.counts.low,
    key_frames: analysis.keyFrames,
    transcript: transcriptDraft,
    transcript_status: transcriptDraft.length ? "ready" : "unsupported_source",
    media_url: null,
    media_kind: null,
    analysis_summary: fallbackReason
      ? `Local fallback QC completed because the cloud service was unavailable: ${fallbackReason}`
      : "Local QC completed using detected video metadata and landing page context.",
    error_message: transcriptDraft.length
      ? null
      : "Cloud transcription is unavailable. Paste a transcript or direct media source to complete speech-level QC.",
    created_at: now(),
    updated_at: now(),
  };
  saveTask(task);
  saveIssues(id, analysis.issues);
  return id;
}

export function parseTranscriptText(raw: string): TranscriptSegment[] {
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\d+$/.test(line) && !/^WEBVTT/i.test(line));

  const segments: TranscriptSegment[] = [];
  let fallbackTime = 0;

  for (const line of lines) {
    const range = line.match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\s*(?:-->|-|to)\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\s*(.*)/i);
    if (range) {
      const start = toSeconds(range[1], range[2], range[3], range[4]);
      const end = toSeconds(range[5], range[6], range[7], range[8]);
      const text = cleanText(range[9]);
      if (text) segments.push({ start, end: Math.max(end, start + 1), text });
      continue;
    }

    const stamped = line.match(/^\[?(\d{1,2}):(\d{2})\]?\s*(.*)$/);
    if (stamped) {
      const start = Number(stamped[1]) * 60 + Number(stamped[2]);
      const text = cleanText(stamped[3]);
      if (text) segments.push({ start, end: start + 4, text });
      fallbackTime = start + 5;
      continue;
    }

    segments.push({ start: fallbackTime, end: fallbackTime + 4, text: line });
    fallbackTime += 5;
  }

  return segments;
}

function toSeconds(hour?: string, minute?: string, second?: string, millis?: string) {
  return (Number(hour ?? 0) * 3600) + (Number(minute ?? 0) * 60) + Number(second ?? 0) + Number(`0.${millis || 0}`);
}

export function updateLocalTranscript(taskId: string, raw: string) {
  const transcript = parseTranscriptText(raw);
  if (!transcript.length) throw new Error("No transcript lines detected.");
  const task = patchLocalTask(taskId, {
    transcript,
    transcript_status: "ready",
    error_message: null,
    analysis_summary: "Transcript imported manually. QC findings now include speech-copy review.",
  });
  return task;
}

export function subscribeLocalQc(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
