import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Copy, ExternalLink, Radio } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Kind = "kpoint" | "drm_hls" | "youtube_vimeo" | "host_blocked" | "no_media" | "unknown";

interface Classified {
  kind: Kind;
  label: string;
  recommendation: string;
  ctaLiveCapture: boolean;
}

export function classifyResolverError(msg: string): Classified {
  const m = msg || "";
  if (/kpoint|bajajfinserv|kapsule/i.test(m))
    return { kind: "kpoint", label: "Signed CDN video (Bajaj kapsule)", recommendation: "kpoint signs URLs in the player at runtime, so the server can't download the file. Record the player in your browser using Live Capture.", ctaLiveCapture: true };
  if (/DRM|encrypted|HLS|\.m3u8/i.test(m))
    return { kind: "drm_hls", label: "DRM / HLS stream", recommendation: "This is an adaptive or encrypted stream. Gemini's Files API needs a direct .mp4/.webm — use Live Capture to record playback instead.", ctaLiveCapture: true };
  if (/YouTube|Vimeo/i.test(m))
    return { kind: "youtube_vimeo", label: "YouTube / Vimeo embed", recommendation: "These platforms block direct downloads. Use Live Capture to record the embedded player.", ctaLiveCapture: true };
  if (/403|blocked|Host may block|server-side download/i.test(m))
    return { kind: "host_blocked", label: "Host blocked server download", recommendation: "The video host refused our server fetch (geo/anti-bot). Live Capture runs in your browser and bypasses this.", ctaLiveCapture: true };
  if (/No direct media file/i.test(m))
    return { kind: "no_media", label: "No direct media file found", recommendation: "We couldn't extract a .mp4/.webm from the page HTML. Open the source page to confirm a video exists, or try Live Capture.", ctaLiveCapture: true };
  return { kind: "unknown", label: "Deep Review failed", recommendation: "See the resolver message below. If the video plays in your browser, Live Capture is the most reliable fallback.", ctaLiveCapture: true };
}

export function DeepReviewErrorPanel({ errorMessage, videoUrl }: { errorMessage: string; videoUrl?: string | null }) {
  const c = classifyResolverError(errorMessage);
  const scrollToCapture = () => {
    const el = document.getElementById("live-capture");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    else toast({ title: "Live Capture unavailable", description: "Live Capture isn't mounted for this video type.", variant: "destructive" });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(errorMessage); toast({ title: "Copied error" }); } catch {}
  };
  return (
    <Alert variant="destructive" className="mt-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{c.label}</AlertTitle>
      <AlertDescription>
        <p className="mt-1 text-sm">{c.recommendation}</p>
        <p className="mt-2 break-words rounded-md bg-destructive/10 p-2 text-[11px] font-mono leading-relaxed text-muted-foreground">
          {errorMessage}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {c.ctaLiveCapture && (
            <Button size="sm" onClick={scrollToCapture}>
              <Radio className="mr-1 h-3 w-3" /> Use Live Capture
            </Button>
          )}
          {videoUrl && (
            <Button size="sm" variant="outline" asChild>
              <a href={videoUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-3 w-3" /> Open source page
              </a>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={copy}>
            <Copy className="mr-1 h-3 w-3" /> Copy error
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
