import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getLocalTask, isLocalId } from "@/lib/local-qc";
import { classifyResolverError } from "@/components/DeepReviewErrorPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BUSINESS_PERSONAS: { key: string; label: string; persona: string }[] = [
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

interface Props {
  taskId: string;
  videoUrl: string;
  pageContext?: string | null;
}

export function DeepReviewPanel({ taskId, videoUrl, pageContext }: Props) {
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [business, setBusiness] = useState(BUSINESS_PERSONAS[0].key);
  const [persona, setPersona] = useState(BUSINESS_PERSONAS[0].persona);

  const ensureCloudTask = async () => {
    if (!isLocalId(taskId)) return taskId;
    const localTask = getLocalTask(taskId);
    if (!localTask) throw new Error("Local task not found. Please scan the video again.");
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("qc_tasks")
      .insert({
        url: localTask.url,
        status: "completed",
        video_url: localTask.video_url,
        page_title: localTask.page_title,
        page_markdown: localTask.page_markdown,
        thumbnail_url: localTask.thumbnail_url,
        detected_videos: localTask.video_url ? [{ url: localTask.video_url, title: localTask.page_title ?? "Detected video" }] : [],
        video_count: 1,
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
      if (cloudTaskId !== taskId) navigate(`/task/${cloudTaskId}`);
      const { data, error } = await supabase.functions.invoke("deep-video-review", {
        body: { taskId: cloudTaskId, videoUrl, pageContext, persona },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Deep review complete", description: `${(data as any)?.issues ?? 0} real issues · score ${(data as any)?.overall ?? "—"}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const c = classifyResolverError(msg);
      toast({ title: `Deep review failed · ${c.label}`, description: msg, variant: "destructive" });
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
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Business</label>
        <Select
          value={business}
          onValueChange={(v) => {
            setBusiness(v);
            const match = BUSINESS_PERSONAS.find((b) => b.key === v);
            if (match) setPersona(match.persona);
          }}
        >
          <SelectTrigger className="h-8 w-[220px] text-xs">
            <SelectValue placeholder="Select business" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {BUSINESS_PERSONAS.map((b) => (
              <SelectItem key={b.key} value={b.key} className="text-xs">{b.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Persona</label>
        <input
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
          placeholder="e.g. First-time customer, skeptical buyer, mobile user…"
        />
      </div>
    </div>
  );
}
