import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { BUCKET_LABEL, KeyFrame, QcIssue, QcTask, TranscriptSegment, scoreColor, severityClass, Severity } from "@/lib/qc-types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, Loader2, AlertTriangle, ShieldAlert, Activity, Sparkles, Copy, Search, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const BUCKET_ICONS: Record<string, any> = { technical: Activity, brand: Sparkles, strategic: ShieldAlert, contextual: AlertTriangle };

export default function TaskDetail() {
  const { id } = useParams();
  const [task, setTask] = useState<QcTask | null>(null);
  const [issues, setIssues] = useState<QcIssue[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(60);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const [{ data: t }, { data: is }] = await Promise.all([
        supabase.from("qc_tasks").select("*").eq("id", id).maybeSingle(),
        supabase.from("qc_issues").select("*").eq("task_id", id).order("timestamp_sec", { ascending: true, nullsFirst: false }),
      ]);
      if (t) setTask(t as unknown as QcTask);
      if (is) setIssues(is as unknown as QcIssue[]);
    };
    load();
    const ch = supabase.channel(`task_${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "qc_tasks", filter: `id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "qc_issues", filter: `task_id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  const buckets = useMemo(() => ([
    { key: "technical" as const, score: task?.technical_score, weight: 25 },
    { key: "brand" as const, score: task?.brand_score, weight: 30 },
    { key: "strategic" as const, score: task?.strategic_score, weight: 20 },
    { key: "contextual" as const, score: task?.contextual_score, weight: 25 },
  ]), [task]);

  const issuesByBucket = useMemo(() => {
    const m: Record<string, QcIssue[]> = { technical: [], brand: [], strategic: [], contextual: [] };
    issues.forEach((i) => m[i.bucket]?.push(i));
    return m;
  }, [issues]);

  const seek = (t: number) => {
    if (videoRef.current) { videoRef.current.currentTime = t; videoRef.current.play().catch(() => {}); }
    setCurrentTime(t);
  };

  if (!task) {
    return (
      <div className="min-h-screen"><AppHeader />
        <div className="flex items-center justify-center py-32 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading task…</div>
      </div>
    );
  }

  const isProcessing = task.status === "processing";
  const sevCounts: { s: Severity; n: number; label: string }[] = [
    { s: "critical", n: task.critical_count, label: "Critical" },
    { s: "high", n: task.high_count, label: "High" },
    { s: "medium", n: task.medium_count, label: "Medium" },
    { s: "low", n: task.low_count, label: "Low" },
  ];

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-[1600px] px-6 py-6">
        <Link
          to={task.url ? `/new?url=${encodeURIComponent(task.url)}` : "/new"}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to video list for this URL
        </Link>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{task.page_title ?? "Untitled page"}</h1>
            <a href={task.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 truncate text-sm text-muted-foreground hover:text-primary">
              {task.url} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Overall Score</div>
              <div className={`text-4xl font-semibold ${scoreColor(task.overall_score)}`}>
                {task.overall_score ?? (isProcessing ? "—" : "—")}<span className="text-base text-muted-foreground">/100</span>
              </div>
            </div>
          </div>
        </div>

        {task.status === "failed" && (
          <div className="surface-card mt-4 border-severity-critical/40 p-4 text-sm text-severity-critical">
            Analysis failed: {task.error_message}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_400px]">
          {/* LEFT: player + timeline + keyframes */}
          <div className="space-y-5">
            <div className="surface-card overflow-hidden">
              <div className="relative aspect-video bg-black">
                {task.video_url ? (
                  <VideoPlayer
                    url={task.video_url}
                    videoRef={videoRef}
                    onLoadedMetadata={(d) => setDuration(d || 60)}
                    onTimeUpdate={(t) => setCurrentTime(t)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    {isProcessing ? <Loader2 className="h-6 w-6 animate-spin" /> : "No video detected on page"}
                  </div>
                )}
              </div>

              {/* QC Timeline */}
              <div className="border-t border-border/60 p-4">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium uppercase tracking-wider text-muted-foreground">QC Timeline</span>
                  <span className="text-muted-foreground">{Math.round(currentTime)}s / {Math.round(duration)}s</span>
                </div>
                <div className="relative h-10 rounded-md bg-secondary/60 ring-1 ring-border">
                  <div className="absolute inset-y-0 left-0 bg-primary/20" style={{ width: `${(currentTime / duration) * 100}%` }} />
                  {issues.filter((i) => i.timestamp_sec != null).map((i) => (
                    <Tooltip key={i.id}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => seek(i.timestamp_sec ?? 0)}
                          className={`absolute top-1 h-8 w-1.5 rounded-sm ${markerClass(i.severity)}`}
                          style={{ left: `calc(${((i.timestamp_sec ?? 0) / duration) * 100}% - 3px)` }}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <div className="text-xs font-medium">{i.title}</div>
                        <div className="text-[11px] text-muted-foreground">@{Math.round(i.timestamp_sec ?? 0)}s · {i.severity}</div>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>

              {/* Keyframes */}
              {task.key_frames?.length > 0 && (
                <div className="border-t border-border/60 p-4">
                  <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Flagged Key Frames</div>
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {task.key_frames.map((kf: KeyFrame, idx) => (
                      <Tooltip key={idx}>
                        <TooltipTrigger asChild>
                          <button onClick={() => seek(kf.timestamp_sec)} className="group shrink-0 text-left">
                            <div className={`flex h-20 w-32 flex-col items-center justify-center rounded-md border bg-gradient-to-br from-secondary to-secondary/30 ${severityClass(kf.severity)} transition-transform group-hover:-translate-y-0.5`}>
                              <span className="text-lg font-semibold">{Math.round(kf.timestamp_sec)}s</span>
                              <span className="px-2 text-center text-[10px] uppercase tracking-wider opacity-80">{kf.severity}</span>
                            </div>
                            <div className="mt-1.5 w-32 truncate text-xs text-muted-foreground">{kf.label}</div>
                          </button>
                        </TooltipTrigger>
                        {kf.suggested_fix && (
                          <TooltipContent side="bottom" className="max-w-xs">
                            <div className="text-xs font-medium">Suggested Fix</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{kf.suggested_fix}</div>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Transcript */}
            <TranscriptPanel
              taskId={task.id}
              videoUrl={task.video_url}
              mediaUrl={task.media_url}
              mediaKind={task.media_kind}
              transcript={(task.transcript ?? []) as TranscriptSegment[]}
              transcriptStatus={task.transcript_status}
              transcriptError={task.error_message}
              currentTime={currentTime}
              isProcessing={isProcessing}
              onSeek={seek}
            />

            {/* Severity breakdown */}
            <div className="surface-card p-5">
              <div className="mb-4 text-sm font-medium">Severity Breakdown</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {sevCounts.map((s) => (
                  <div key={s.s} className={`rounded-lg border p-4 ${severityClass(s.s)}`}>
                    <div className="text-3xl font-semibold">{s.n}</div>
                    <div className="mt-0.5 text-xs uppercase tracking-wider opacity-80">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {task.analysis_summary && (
              <div className="surface-card p-5">
                <div className="mb-2 text-sm font-medium">Analysis Summary</div>
                <p className="text-sm leading-relaxed text-muted-foreground">{task.analysis_summary}</p>
                {task.customer_intent && (
                  <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border/60 pt-4 text-sm">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Customer Intent</div>
                      <div className="mt-1">{task.customer_intent}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Topic Match</div>
                      <div className={`mt-1 text-xl font-semibold ${scoreColor(task.topic_match_score)}`}>{task.topic_match_score ?? "—"}/100</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT: bucket scores */}
          <aside className="space-y-3">
            <div className="surface-card p-5">
              <div className="mb-3 text-sm font-medium">Score Buckets</div>
              <Accordion type="multiple" defaultValue={["brand"]} className="space-y-2">
                {buckets.map((b) => {
                  const Icon = BUCKET_ICONS[b.key];
                  const list = issuesByBucket[b.key] ?? [];
                  const score = b.score ?? 0;
                  return (
                    <AccordionItem key={b.key} value={b.key} className="overflow-hidden rounded-lg border border-border bg-secondary/30">
                      <AccordionTrigger className="px-3 py-2.5 hover:no-underline">
                        <div className="flex w-full items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div>
                          <div className="flex-1 text-left">
                            <div className="text-sm font-medium">{BUCKET_LABEL[b.key]}</div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Weight {b.weight}%</div>
                          </div>
                          <div className={`text-lg font-semibold ${scoreColor(b.score)}`}>{b.score ?? "—"}</div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-3 pb-3">
                        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-border">
                          <div className={`h-full ${score >= 80 ? "bg-score-good" : score >= 60 ? "bg-score-warn" : "bg-score-bad"}`} style={{ width: `${score}%` }} />
                        </div>
                        {list.length === 0 ? (
                          <div className="text-xs text-muted-foreground">No issues flagged in this bucket.</div>
                        ) : (
                          <ul className="space-y-2">
                            {list.map((i) => (
                              <li key={i.id} className="rounded-md border border-border bg-card/50 p-2.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="text-sm font-medium">{i.title}</div>
                                  <Badge variant="outline" className={`shrink-0 text-[10px] uppercase ${severityClass(i.severity)}`}>{i.severity}</Badge>
                                </div>
                                {i.timestamp_sec != null && (
                                  <button onClick={() => seek(i.timestamp_sec ?? 0)} className="mt-1 text-[11px] text-primary hover:underline">@ {Math.round(i.timestamp_sec)}s</button>
                                )}
                                {i.description && <p className="mt-1.5 text-xs text-muted-foreground">{i.description}</p>}
                                {i.suggested_fix && (
                                  <p className="mt-1.5 rounded border-l-2 border-primary/50 bg-primary/5 p-1.5 text-[11px] text-foreground/90">
                                    <span className="font-medium text-primary">Fix:</span> {i.suggested_fix}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>

            {isProcessing && (
              <div className="surface-card flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" /> Analyzing… results stream in live.
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

function VideoPlayer({ url, videoRef, onLoadedMetadata, onTimeUpdate }: {
  url: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  onLoadedMetadata: (d: number) => void;
  onTimeUpdate: (t: number) => void;
}) {
  const isFile = /\.(mp4|webm|mov|m3u8|mpd)(\?|#|$)/i.test(url);
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  const isBajaj = /videos\.bajajfinserv\.in/i.test(url);

  if (isFile) {
    return (
      <video
        ref={videoRef}
        src={url}
        controls
        playsInline
        preload="metadata"
        className="h-full w-full"
        onLoadedMetadata={(e) => onLoadedMetadata((e.target as HTMLVideoElement).duration)}
        onTimeUpdate={(e) => onTimeUpdate((e.target as HTMLVideoElement).currentTime)}
      />
    );
  }

  let embed = url;
  if (ytMatch) embed = `https://www.youtube.com/embed/${ytMatch[1]}`;
  else if (vimeoMatch) embed = `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  else if (isBajaj && !/embedded/.test(url)) {
    const id = url.match(/(gcc-[a-f0-9-]+)/i)?.[1];
    if (id) embed = `https://videos.bajajfinserv.in/kapsule/${id}/nv3/embedded`;
  }

  return (
    <iframe
      src={embed}
      className="h-full w-full"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowFullScreen
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

function markerClass(s: Severity) {
  return {
    critical: "bg-severity-critical",
    high: "bg-severity-high",
    medium: "bg-severity-medium",
    low: "bg-severity-low",
    info: "bg-severity-info",
  }[s];
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function TranscriptPanel({
  taskId,
  videoUrl,
  mediaUrl,
  mediaKind,
  transcript,
  transcriptStatus,
  currentTime,
  isProcessing,
  onSeek,
}: {
  taskId: string;
  videoUrl: string | null;
  mediaUrl: string | null;
  mediaKind: "mp4" | "hls" | null;
  transcript: TranscriptSegment[];
  transcriptStatus: QcTask["transcript_status"];
  transcriptError: string | null;
  currentTime: number;
  isProcessing: boolean;
  onSeek: (t: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [overrideUrl, setOverrideUrl] = useState("");
  const rowRefs = useRef<Record<number, HTMLButtonElement | null>>({});


  const activeIdx = useMemo(() => {
    if (!transcript.length) return -1;
    const i = transcript.findIndex((s) => currentTime >= s.start && currentTime < s.end);
    if (i !== -1) return i;
    let last = -1;
    for (let j = 0; j < transcript.length; j++) if (transcript[j].start <= currentTime) last = j;
    return last;
  }, [transcript, currentTime]);

  useEffect(() => {
    if (activeIdx < 0) return;
    rowRefs.current[activeIdx]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx]);

  const filtered = useMemo(() => {
    if (!query.trim()) return transcript.map((s, i) => ({ s, i }));
    const q = query.toLowerCase();
    return transcript
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.text.toLowerCase().includes(q) || (s.speaker ?? "").toLowerCase().includes(q));
  }, [transcript, query]);

  const copyAll = async () => {
    const txt = transcript.map((s) => `[${fmtTime(s.start)}]${s.speaker ? ` ${s.speaker}:` : ""} ${s.text}`).join("\n");
    await navigator.clipboard.writeText(txt);
    toast({ title: "Transcript copied" });
  };

  const retry = async (mediaUrlOverride?: string) => {
    setRetrying(true);
    try {
      const { error } = await supabase.functions.invoke("transcribe-video", {
        body: { taskId, videoUrl, mediaUrlOverride },
      });
      if (error) throw error;
      toast({ title: "Re-transcribing…", description: "This may take up to a minute." });
    } catch (e) {
      toast({ title: "Retry failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setRetrying(false);
    }
  };

  const submitOverride = (e: React.FormEvent) => {
    e.preventDefault();
    const u = overrideUrl.trim();
    if (!u) return;
    retry(u);
  };

  const showPending = transcript.length === 0 && (transcriptStatus === "pending" || (isProcessing && !transcriptStatus));
  const showUnsupported = transcript.length === 0 && transcriptStatus === "unsupported_source";
  const showFailed = transcript.length === 0 && transcriptStatus === "failed";
  const showEmpty = transcript.length === 0 && !showPending && !showUnsupported && !showFailed;
  const showOverride = showUnsupported || showFailed;

  let resolvedHost: string | null = null;
  try {
    if (mediaUrl && videoUrl && new URL(mediaUrl).host !== new URL(videoUrl).host) {
      resolvedHost = new URL(mediaUrl).host;
    }
  } catch { /* ignore */ }

  return (
    <div className="surface-card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4 text-primary" /> Transcript
          {transcript.length > 0 && (
            <span className="text-[11px] font-normal text-muted-foreground">· {transcript.length} segments</span>
          )}
          {resolvedHost && transcript.length > 0 && (
            <span className="text-[11px] font-normal text-muted-foreground">
              · audio source: {resolvedHost}{mediaKind === "hls" ? " (HLS)" : ""}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-8 w-48 pl-7 text-xs"
              disabled={!transcript.length}
            />
          </div>
          <Button size="sm" variant="outline" onClick={copyAll} disabled={!transcript.length} className="h-8 gap-1.5 text-xs">
            <Copy className="h-3.5 w-3.5" /> Copy
          </Button>
        </div>
      </div>

      {transcript.length === 0 ? (
        <div className="space-y-3">
          <div className="rounded-md border border-dashed border-border bg-secondary/30 p-6 text-center text-xs text-muted-foreground">
            {showPending && (
              <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing audio from the video…</span>
            )}
            {showUnsupported && (
              <div className="space-y-1.5">
                <div className="font-medium text-foreground/80">Transcript not available</div>
                <div>We couldn't auto-resolve a direct audio file from this URL. Paste a direct .mp4 / .m3u8 below to enable speech-to-text — your player URL stays unchanged.</div>
              </div>
            )}
            {showFailed && (
              <div className="space-y-2">
                <div>Transcription failed.</div>
                <Button size="sm" variant="outline" onClick={() => retry()} disabled={retrying} className="h-7 text-xs">
                  {retrying ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                  Retry transcription
                </Button>
              </div>
            )}
            {showEmpty && "Transcript not available for this video."}
          </div>

          {showOverride && (
            <form onSubmit={submitOverride} className="rounded-md border border-border bg-secondary/20 p-3">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Transcription source override
              </div>
              <div className="mb-2 text-[11px] text-muted-foreground">
                Player keeps using your original URL. This is only used to fetch audio for the transcript.
              </div>
              <div className="flex gap-2">
                <Input
                  value={overrideUrl}
                  onChange={(e) => setOverrideUrl(e.target.value)}
                  placeholder="https://…/video.mp4"
                  className="h-8 flex-1 text-xs"
                />
                <Button type="submit" size="sm" disabled={retrying || !overrideUrl.trim()} className="h-8 text-xs">
                  {retrying ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                  Transcribe from this URL
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <ScrollArea className="h-72 rounded-md border border-border bg-secondary/20">
          <ul className="divide-y divide-border/60">
            {filtered.map(({ s, i }) => {
              const active = i === activeIdx;
              return (
                <li key={i}>
                  <button
                    ref={(el) => { rowRefs.current[i] = el; }}
                    onClick={() => onSeek(s.start)}
                    className={`flex w-full gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/60 ${
                      active ? "border-l-2 border-primary bg-primary/10" : "border-l-2 border-transparent"
                    }`}
                  >
                    <span className={`shrink-0 font-mono text-[11px] tabular-nums ${active ? "text-primary" : "text-muted-foreground"}`}>
                      {fmtTime(s.start)}
                    </span>
                    <span className="min-w-0 flex-1">
                      {s.speaker && <span className="mr-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{s.speaker}</span>}
                      <span className={active ? "text-foreground" : "text-foreground/85"}>{s.text}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">No segments match “{query}”.</li>
            )}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
