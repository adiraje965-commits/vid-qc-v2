import type { TranscriptSegment } from "./qc-types";

export async function pullLocalTranscript(videoUrl: string | null): Promise<TranscriptSegment[]> {
  if (!videoUrl) throw new Error("No video URL available.");
  const response = await fetch("/api/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoUrl }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error ?? "Transcript pull failed.");
  }
  return (data?.segments ?? []) as TranscriptSegment[];
}

export function transcriptSegmentsToText(segments: TranscriptSegment[]) {
  return segments
    .map((segment) => `${formatStamp(segment.start)} ${segment.text}`)
    .join("\n");
}

function formatStamp(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
