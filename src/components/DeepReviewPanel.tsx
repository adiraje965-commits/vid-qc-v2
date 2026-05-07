import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getLocalTask, isLocalId } from "@/lib/local-qc";

interface Props {
  taskId: string;
  videoUrl: string;
  pageContext?: string | null;
}

export function DeepReviewPanel({ taskId, videoUrl, pageContext }: Props) {
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [persona, setPersona] = useState("First-time Bajaj Finance customer evaluating a personal loan");

  const ensureCloudTask = async () => {
    if (!isLocalId(taskId)) return taskId;
    const localTask = getLocalTask(taskId);
    if (!localTask) throw new Error("Local task not found. Please scan the video again.");
    const { data, error } = await supabase
      .from("qc_tasks")
      .insert({
        url: localTask.url,
        status: "completed",
        video_url: localTask.video_url,
        page_title: localTask.page_title,
        page_markdown: localTask.page_markdown,
        thumbnail_url: localTask.thumbnail_url,
        detected_videos: localTask.detected_videos ?? [],
        video_count: localTask.video_count ?? 1,
        transcript_status: "pending",
        analysis_summary: "Ready for real video QC. Click Run Deep Review to analyze the actual video frame by frame.",
        owner_id: null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };

  const run = async () => {
    setRunning(true);
    try {
      const cloudTaskId = await ensureCloudTask();
      const { data, error } = await supabase.functions.invoke("deep-video-review", {
        body: { taskId: cloudTaskId, videoUrl, pageContext, persona },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Deep review complete", description: `${(data as any)?.issues ?? 0} real issues · score ${(data as any)?.overall ?? "—"}` });
      if (cloudTaskId !== taskId) navigate(`/task/${cloudTaskId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Deep review failed", description: msg, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="surface-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <div className="text-sm font-medium">Deep Video Review</div>
          <Badge variant="outline" className="border-primary/40 text-primary">Gemini 2.5 Pro · Files API (up to 2GB / 1hr)</Badge>
        </div>
        <Button size="sm" onClick={run} disabled={running}>
          {running ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Watching video…</> : "Run Deep Review"}
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Server downloads the actual video, uploads it to Google AI's Files API, and lets Gemini 2.5 Pro watch it end-to-end (visual + audio + supers + pacing). Supports videos up to ~2GB / 1hr. Replaces previous QC findings with real ones.
      </p>
      <div className="flex items-center gap-2">
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Persona</label>
        <input
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
          placeholder="e.g. First-time customer, skeptical buyer, mobile user…"
        />
      </div>
    </div>
  );
}
