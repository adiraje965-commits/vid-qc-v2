import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ExternalLink, GitCompare, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { scoreColor, QcIssue } from "@/lib/qc-types";
import { briefToContextString, BriefDraft, EMPTY_BRIEF } from "@/lib/prelive-types";
import { ExportMenu } from "@/components/ExportMenu";
import { exportTaskJson, exportTaskPdf } from "@/lib/qc-export";

interface Asset {
  id: string;
  campaign_name: string;
  business_key: string | null;
  persona: string | null;
  channel: string | null;
  aspect_ratio: string | null;
  target_runtime_sec: number | null;
  languages: string[];
  key_claims: string[];
  mandatory_disclaimers: string[];
  notes: string | null;
  thumbnail_url: string | null;
  latest_version_id: string | null;
  owner_id: string | null;
}

interface Version {
  id: string;
  version_label: string;
  version_index: number;
  playbook_url: string;
  resolved_video_url: string | null;
  resolved_thumbnail_url: string | null;
  change_notes: string | null;
  qc_task_id: string | null;
  status: string;
  resolve_error: string | null;
  created_at: string;
}

interface TaskLite {
  id: string;
  overall_score: number | null;
  technical_score: number | null;
  brand_score: number | null;
  strategic_score: number | null;
  contextual_score: number | null;
  critical_count: number | null;
  high_count: number | null;
  status: string;
}

export default function PreLiveAsset() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [tasks, setTasks] = useState<Record<string, TaskLite>>({});
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [newPlaybookUrl, setNewPlaybookUrl] = useState("");
  const [newChangeNotes, setNewChangeNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [compareTo, setCompareTo] = useState<string>("");

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const [{ data: a }, { data: vs }] = await Promise.all([
        supabase.from("prelive_assets").select("*").eq("id", id).maybeSingle(),
        supabase.from("prelive_versions").select("*").eq("asset_id", id).order("version_index", { ascending: true }),
      ]);
      setAsset(a as any);
      setVersions((vs ?? []) as any);
      const taskIds = (vs ?? []).map((v: any) => v.qc_task_id).filter(Boolean);
      if (taskIds.length) {
        const { data: ts } = await supabase
          .from("qc_tasks")
          .select("id,overall_score,technical_score,brand_score,strategic_score,contextual_score,critical_count,high_count,status")
          .in("id", taskIds);
        const map: Record<string, TaskLite> = {};
        (ts ?? []).forEach((t: any) => { map[t.id] = t; });
        setTasks(map);
      }
      setLoading(false);
    };
    load();
    const ch = supabase.channel(`prelive_asset_${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "prelive_versions", filter: `asset_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "qc_tasks" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  const briefDraft: BriefDraft = useMemo(() => ({
    ...EMPTY_BRIEF,
    campaign_name: asset?.campaign_name ?? "",
    business_key: asset?.business_key ?? EMPTY_BRIEF.business_key,
    persona: asset?.persona ?? EMPTY_BRIEF.persona,
    channel: asset?.channel ?? EMPTY_BRIEF.channel,
    aspect_ratio: asset?.aspect_ratio ?? EMPTY_BRIEF.aspect_ratio,
    target_runtime_sec: asset?.target_runtime_sec ?? null,
    languages: asset?.languages ?? [],
    key_claims: asset?.key_claims ?? [],
    mandatory_disclaimers: asset?.mandatory_disclaimers ?? [],
    notes: asset?.notes ?? "",
  }), [asset]);

  const addVersion = async () => {
    if (!asset || !user) return;
    if (!newPlaybookUrl.trim()) { toast({ title: "Playbook URL required", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const { data: resolved, error: rErr } = await supabase.functions.invoke("resolve-playbook", { body: { url: newPlaybookUrl } });
      if (rErr) throw rErr;
      if (!(resolved as any)?.ok) throw new Error((resolved as any)?.error || "Could not resolve URL");
      const videoUrl = (resolved as any).directVideoUrl as string;
      const thumbUrl = (resolved as any).thumbnailUrl as string | null;
      const title = (resolved as any).title as string | null;

      const nextIndex = (versions[versions.length - 1]?.version_index ?? 0) + 1;
      const label = `v${nextIndex}`;

      const { data: task, error: tErr } = await supabase
        .from("qc_tasks")
        .insert({
          owner_id: user.id,
          url: newPlaybookUrl,
          video_url: videoUrl,
          thumbnail_url: thumbUrl,
          page_title: title || `${asset.campaign_name} ${label}`,
          status: "processing",
          source_kind: "prelive_playbook",
          analysis_summary: `Pre-live ${label}. Running Deep Review against the brief…`,
        })
        .select("id").single();
      if (tErr) throw tErr;

      const { data: version, error: vErr } = await supabase
        .from("prelive_versions")
        .insert({
          asset_id: asset.id, version_label: label, version_index: nextIndex,
          playbook_url: newPlaybookUrl, resolved_video_url: videoUrl, resolved_thumbnail_url: thumbUrl,
          change_notes: newChangeNotes || null, qc_task_id: task.id, status: "analyzing",
        })
        .select("id").single();
      if (vErr) throw vErr;

      await Promise.all([
        supabase.from("qc_tasks").update({ prelive_version_id: version.id }).eq("id", task.id),
        supabase.from("prelive_assets").update({ latest_version_id: version.id }).eq("id", asset.id),
      ]);

      const pageContext = briefToContextString(briefDraft, newChangeNotes);
      void supabase.functions.invoke("deep-video-review", {
        body: { taskId: task.id, videoUrl, pageContext, persona: asset.persona ?? briefDraft.persona },
      }).then(async ({ error }) => {
        await supabase.from("prelive_versions").update({ status: error ? "failed" : "ready", resolve_error: error?.message ?? null }).eq("id", version.id);
      });

      toast({ title: `${label} created`, description: "Deep Review running in the background." });
      setAddOpen(false); setNewPlaybookUrl(""); setNewChangeNotes("");
    } catch (e) {
      toast({ title: "Couldn't add version", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen"><AppHeader /><div className="p-8 text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Loading…</div></div>;
  if (!asset) return <div className="min-h-screen"><AppHeader /><div className="p-8 text-sm">Asset not found.</div></div>;

  const latest = versions.find((v) => v.id === asset.latest_version_id) ?? versions[versions.length - 1];

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <Button variant="ghost" size="sm" asChild className="mb-4"><Link to="/prelive"><ArrowLeft className="mr-1 h-4 w-4" />Pre-Live</Link></Button>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{asset.campaign_name}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
              {asset.business_key && <Badge variant="outline" className="border-white/10">{asset.business_key}</Badge>}
              {asset.channel && <Badge variant="outline" className="border-white/10">{asset.channel}</Badge>}
              {asset.aspect_ratio && <Badge variant="outline" className="border-white/10">{asset.aspect_ratio}</Badge>}
              {asset.target_runtime_sec && <Badge variant="outline" className="border-white/10">{asset.target_runtime_sec}s</Badge>}
              {asset.languages?.map((l) => <Badge key={l} variant="outline" className="border-white/10">{l}</Badge>)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {versions.length >= 2 && (
              <div className="flex items-center gap-1.5">
                <Select value={compareTo} onValueChange={setCompareTo}>
                  <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue placeholder="Compare to…" /></SelectTrigger>
                  <SelectContent>
                    {versions.filter((v) => v.id !== latest?.id).map((v) => <SelectItem key={v.id} value={v.id}>Compare {v.version_label} → {latest?.version_label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {compareTo && latest && (
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/prelive/asset/${asset.id}/diff?from=${compareTo}&to=${latest.id}`}><GitCompare className="mr-1 h-3 w-3" />Diff</Link>
                  </Button>
                )}
              </div>
            )}
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-3 w-3" />Add new version</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add new version</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Playbook URL</label>
                    <Input value={newPlaybookUrl} onChange={(e) => setNewPlaybookUrl(e.target.value)} placeholder="https://playbook.com/s/… or direct .mp4" className="mt-1 h-9" />
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Change notes</label>
                    <Textarea value={newChangeNotes} onChange={(e) => setNewChangeNotes(e.target.value)} rows={3} placeholder="What changed vs the previous cut?" className="mt-1" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                  <Button onClick={addVersion} disabled={submitting}>{submitting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Adding…</> : <><Sparkles className="mr-1 h-4 w-4" />Add & run</>}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Brief panel */}
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_2fr]">
          <div className="surface-card p-4">
            <div className="text-sm font-medium">Brief</div>
            <div className="mt-3 space-y-2 text-xs">
              <div><span className="text-muted-foreground">Persona:</span> {asset.persona || "—"}</div>
              {asset.key_claims.length > 0 && <div><div className="text-muted-foreground">Key claims:</div><ul className="mt-1 list-disc pl-4">{asset.key_claims.map((c) => <li key={c}>{c}</li>)}</ul></div>}
              {asset.mandatory_disclaimers.length > 0 && <div><div className="text-muted-foreground">Mandatory disclaimers:</div><ul className="mt-1 list-disc pl-4">{asset.mandatory_disclaimers.map((c) => <li key={c}>{c}</li>)}</ul></div>}
              {asset.notes && <div><div className="text-muted-foreground">Notes:</div><div className="mt-0.5 whitespace-pre-wrap">{asset.notes}</div></div>}
            </div>
          </div>

          {/* Versions timeline */}
          <div className="surface-card p-4">
            <div className="mb-3 text-sm font-medium">Versions ({versions.length})</div>
            <div className="space-y-2">
              {versions.map((v) => {
                const t = v.qc_task_id ? tasks[v.qc_task_id] : null;
                const score = t?.overall_score ?? null;
                return (
                  <div key={v.id} className="flex items-center gap-3 rounded-md border border-white/8 bg-secondary/20 p-3">
                    <div className="h-12 w-20 shrink-0 overflow-hidden rounded bg-secondary">
                      {v.resolved_thumbnail_url ? <img src={v.resolved_thumbnail_url} alt="" className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{v.version_label}</span>
                        <Badge variant="outline" className={
                          v.status === "ready" ? "border-score-good/40 text-score-good"
                          : v.status === "failed" ? "border-severity-critical/40 text-severity-critical"
                          : "border-primary/40 text-primary"
                        }>{v.status}</Badge>
                        {t && <Badge variant="outline" className="border-white/10">{t.critical_count ?? 0}C · {t.high_count ?? 0}H</Badge>}
                      </div>
                      {v.change_notes && <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{v.change_notes}</div>}
                      {v.resolve_error && <div className="mt-0.5 line-clamp-1 text-[11px] text-severity-critical">{v.resolve_error}</div>}
                    </div>
                    {score != null && <div className={`text-xl font-semibold ${scoreColor(score)}`}>{score}</div>}
                    <div className="flex items-center gap-1">
                      <Button asChild size="sm" variant="ghost" title="Open Playbook source"><a href={v.playbook_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /></a></Button>
                      {v.qc_task_id && (
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/task/${v.qc_task_id}`}>Open <ArrowRight className="ml-1 h-3 w-3" /></Link>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
