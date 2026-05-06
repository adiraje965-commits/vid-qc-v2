import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Radio, Square, Video } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Props {
  taskId: string;
  videoUrl: string;
  pageContext?: string | null;
  autoStart?: boolean;
  onDone?: () => void;
}

const CHUNK_MS = 30000; // 30s audio chunks
const FRAME_INTERVAL_MS = 2000;
const FRAMES_PER_BATCH = 4;

export function VideoCapture({ taskId, videoUrl, pageContext, autoStart = true, onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const frameQueueRef = useRef<{ tsSec: number; dataUrl: string }[]>([]);
  const transcriptWindowRef = useRef<string>("");
  const startedAtRef = useRef<number>(0);
  const chunkStartSecRef = useRef<number>(0);
  const tainted = useRef(false);

  const [status, setStatus] = useState<"idle" | "capturing" | "finalizing" | "done" | "error">("idle");
  const [progress, setProgress] = useState({ chunks: 0, batches: 0, errors: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    return () => stop(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    const v = videoRef.current;
    if (!v) return;
    setStatus("capturing");
    setErrorMsg(null);
    startedAtRef.current = performance.now();
    chunkStartSecRef.current = 0;

    try {
      v.muted = true;
      await v.play();
    } catch (e) {
      setErrorMsg("Browser blocked autoplay — click Start to begin capture.");
      setStatus("error");
      return;
    }

    // @ts-ignore
    const stream: MediaStream | undefined = (v as any).captureStream?.() ?? (v as any).mozCaptureStream?.();
    if (!stream) {
      setErrorMsg("This browser can't capture the video element.");
      setStatus("error");
      return;
    }

    // Audio recording
    const audioStream = new MediaStream(stream.getAudioTracks());
    if (!audioStream.getAudioTracks().length) {
      console.warn("No audio track on captured stream");
    } else {
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const rec = new MediaRecorder(audioStream, { mimeType: mime });
      let segStart = 0;
      rec.ondataavailable = async (ev) => {
        if (!ev.data || ev.data.size < 1000) return;
        const startSec = segStart;
        segStart += CHUNK_MS / 1000;
        const fd = new FormData();
        fd.append("taskId", taskId);
        fd.append("startSec", String(startSec));
        fd.append("audio", ev.data, "chunk.webm");
        try {
          const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-chunk`, {
            method: "POST",
            headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
            body: fd,
          });
          if (r.ok) {
            const d = await r.json();
            transcriptWindowRef.current = (transcriptWindowRef.current + " " + (d.appended ? "" : "")).slice(-2000);
            setProgress((p) => ({ ...p, chunks: p.chunks + 1 }));
            // refresh window from server
            const { data: t } = await supabase.from("qc_tasks").select("transcript").eq("id", taskId).maybeSingle();
            const segs = (t?.transcript as any[]) || [];
            transcriptWindowRef.current = segs.slice(-30).map((s) => s.text).join(" ");
          } else {
            setProgress((p) => ({ ...p, errors: p.errors + 1 }));
          }
        } catch {
          setProgress((p) => ({ ...p, errors: p.errors + 1 }));
        }
      };
      rec.start(CHUNK_MS);
      recorderRef.current = rec;
    }

    // Frame sampling
    const canvas = document.createElement("canvas");
    const flushFrames = async () => {
      if (frameQueueRef.current.length === 0) return;
      const batch = frameQueueRef.current.splice(0, FRAMES_PER_BATCH);
      try {
        const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-frames`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          body: JSON.stringify({ taskId, frames: batch, transcriptWindow: transcriptWindowRef.current, pageContext }),
        });
        if (r.ok) setProgress((p) => ({ ...p, batches: p.batches + 1 }));
        else setProgress((p) => ({ ...p, errors: p.errors + 1 }));
      } catch {
        setProgress((p) => ({ ...p, errors: p.errors + 1 }));
      }
    };

    frameTimerRef.current = window.setInterval(() => {
      if (tainted.current || !v.videoWidth) return;
      try {
        const w = Math.min(640, v.videoWidth);
        const h = Math.round((w / v.videoWidth) * v.videoHeight);
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        frameQueueRef.current.push({ tsSec: Math.round(v.currentTime), dataUrl });
        if (frameQueueRef.current.length >= FRAMES_PER_BATCH) flushFrames();
      } catch (err) {
        // CORS taint
        tainted.current = true;
        toast({ title: "Visual QC unavailable", description: "Video host blocks canvas capture (CORS). Audio transcript will still capture.", variant: "destructive" });
      }
    }, FRAME_INTERVAL_MS) as unknown as number;

    v.onended = async () => {
      await stop(true);
    };
  }

  async function stop(finalize: boolean) {
    if (frameTimerRef.current) { clearInterval(frameTimerRef.current); frameTimerRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch {}
    }
    if (!finalize) return;
    setStatus("finalizing");
    // Flush remaining frames
    if (frameQueueRef.current.length) {
      const batch = frameQueueRef.current.splice(0);
      try {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-frames`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          body: JSON.stringify({ taskId, frames: batch, transcriptWindow: transcriptWindowRef.current, pageContext }),
        });
      } catch {}
    }
    // wait briefly for last audio chunk
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/finalize-qc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ taskId }),
      });
    } catch {}
    setStatus("done");
    onDone?.();
  }

  return (
    <div className="surface-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Video className="h-4 w-4 text-primary" />
          <div className="text-sm font-medium">Live Capture QC</div>
          {status === "capturing" && <Badge variant="outline" className="border-score-warn/40 text-score-warn"><Radio className="mr-1 h-3 w-3 animate-pulse" />capturing</Badge>}
          {status === "finalizing" && <Badge variant="outline" className="border-primary/40 text-primary"><Loader2 className="mr-1 h-3 w-3 animate-spin" />finalizing</Badge>}
          {status === "done" && <Badge variant="outline" className="border-score-good/40 text-score-good">complete</Badge>}
          {status === "error" && <Badge variant="outline" className="border-severity-critical/40 text-severity-critical">error</Badge>}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{progress.chunks} audio · {progress.batches} frame batches{progress.errors ? ` · ${progress.errors} errs` : ""}</span>
          {status === "idle" && <Button size="sm" onClick={start}>Start capture</Button>}
          {status === "capturing" && <Button size="sm" variant="outline" onClick={() => stop(true)}><Square className="mr-1 h-3 w-3" />Stop</Button>}
        </div>
      </div>
      {errorMsg && <div className="mb-2 text-xs text-severity-critical">{errorMsg}</div>}
      <video
        ref={videoRef}
        src={videoUrl}
        crossOrigin="anonymous"
        controls
        playsInline
        className="w-full rounded-md bg-black"
        onLoadedMetadata={() => { if (autoStart && status === "idle") start(); }}
      />
      <div className="mt-2 text-[11px] text-muted-foreground">
        Browser plays the video, captures audio + samples frames every 2s, and analyzes them via AI. Tab must stay open until video ends. Works only on direct video URLs (mp4/m3u8) — iframe-embedded players (YouTube/Vimeo/Bajaj iframe) cannot be captured.
      </div>
    </div>
  );
}
