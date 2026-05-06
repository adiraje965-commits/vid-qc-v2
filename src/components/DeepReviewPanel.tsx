import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Props {
  taskId: string;
  videoUrl: string;
  pageContext?: string | null;
}

export function DeepReviewPanel({ taskId, videoUrl, pageContext }: Props) {
  const [running, setRunning] = useState(false);
  const [persona, setPersona] = useState("First-time Bajaj Finance customer evaluating a personal loan");

  const run = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("deep-video-review", {
        body: { taskId, videoUrl, pageContext, persona },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Deep review complete", description: `${(data as any)?.issues ?? 0} real issues · score ${(data as any)?.overall ?? "—"}` });
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
          <Badge variant="outline" className="border-primary/40 text-primary">Gemini 2.5 Pro · native video</Badge>
        </div>
        <Button size="sm" onClick={run} disabled={running}>
          {running ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Watching video…</> : "Run Deep Review"}
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Server downloads the actual video and lets the AI watch it end-to-end (visual + audio + supers + pacing). Replaces previous QC findings with real ones. Works for direct mp4/webm URLs up to 20 MB.
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
