import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BriefForm } from "@/components/prelive/BriefForm";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { BriefDraft, EMPTY_BRIEF, briefToContextString } from "@/lib/prelive-types";

export default function PreLiveNew() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [brief, setBrief] = useState<BriefDraft>(EMPTY_BRIEF);
  const [briefPdfPath, setBriefPdfPath] = useState<string | null>(null);
  const [playbookUrl, setPlaybookUrl] = useState("");
  const [changeNotes, setChangeNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!user) { toast({ title: "Sign in first", variant: "destructive" }); return; }
    if (!brief.campaign_name.trim()) { toast({ title: "Campaign name required", variant: "destructive" }); return; }
    if (!playbookUrl.trim()) { toast({ title: "Playbook URL required", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      // 1. Create asset
      const { data: asset, error: aErr } = await supabase
        .from("prelive_assets")
        .insert({
          owner_id: user.id,
          campaign_name: brief.campaign_name,
          business_key: brief.business_key,
          persona: brief.persona,
          channel: brief.channel,
          aspect_ratio: brief.aspect_ratio,
          target_runtime_sec: brief.target_runtime_sec,
          languages: brief.languages,
          key_claims: brief.key_claims,
          mandatory_disclaimers: brief.mandatory_disclaimers,
          notes: brief.notes,
          brief_pdf_path: briefPdfPath,
        })
        .select("id")
        .single();
      if (aErr) throw aErr;

      // 2. Resolve Playbook URL → direct video
      const { data: resolved, error: rErr } = await supabase.functions.invoke("resolve-playbook", { body: { url: playbookUrl } });
      if (rErr) throw rErr;
      if (!(resolved as any)?.ok) throw new Error((resolved as any)?.error || "Could not resolve Playbook URL");
      const videoUrl = (resolved as any).directVideoUrl as string;
      const thumbUrl = (resolved as any).thumbnailUrl as string | null;
      const title = (resolved as any).title as string | null;

      // 3. Create QC task (pre-live)
      const { data: task, error: tErr } = await supabase
        .from("qc_tasks")
        .insert({
          owner_id: user.id,
          url: playbookUrl,
          video_url: videoUrl,
          thumbnail_url: thumbUrl,
          page_title: title || brief.campaign_name,
          status: "processing",
          source_kind: "prelive_playbook",
          analysis_summary: "Pre-live draft cut. Running Deep Review against the brief…",
        })
        .select("id")
        .single();
      if (tErr) throw tErr;

      // 4. Create version row
      const { data: version, error: vErr } = await supabase
        .from("prelive_versions")
        .insert({
          asset_id: asset.id,
          version_label: "v1",
          version_index: 1,
          playbook_url: playbookUrl,
          resolved_video_url: videoUrl,
          resolved_thumbnail_url: thumbUrl,
          change_notes: changeNotes || null,
          qc_task_id: task.id,
          status: "analyzing",
        })
        .select("id")
        .single();
      if (vErr) throw vErr;

      // 5. Backfill prelive_version_id + latest_version_id + thumbnail
      await Promise.all([
        supabase.from("qc_tasks").update({ prelive_version_id: version.id }).eq("id", task.id),
        supabase.from("prelive_assets").update({ latest_version_id: version.id, thumbnail_url: thumbUrl ?? null }).eq("id", asset.id),
      ]);

      // 6. Kick off deep review (don't await; user navigates away)
      const pageContext = briefToContextString(brief, changeNotes);
      void supabase.functions.invoke("deep-video-review", {
        body: { taskId: task.id, videoUrl, pageContext, persona: brief.persona },
      }).then(async ({ error }) => {
        await supabase.from("prelive_versions").update({ status: error ? "failed" : "ready", resolve_error: error?.message ?? null }).eq("id", version.id);
      });

      toast({ title: "Pre-live asset created", description: "Deep Review running in the background." });
      nav(`/prelive/asset/${asset.id}`);
    } catch (e) {
      toast({ title: "Couldn't create asset", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <Button variant="ghost" size="sm" onClick={() => nav(-1)} className="mb-4"><ArrowLeft className="mr-1 h-4 w-4" />Back</Button>
        <h1 className="text-2xl font-semibold tracking-tight">New pre-live asset</h1>
        <p className="mt-1 text-sm text-muted-foreground">Provide a brief (or upload the brief PDF) and the Playbook share link of v1.</p>

        <div className="mt-6 surface-card p-5">
          <div className="mb-3 text-sm font-medium">1 · Brief</div>
          <BriefForm value={brief} onChange={setBrief} briefPdfPath={briefPdfPath} onPdfPathChange={setBriefPdfPath} ownerId={user?.id ?? null} />
        </div>

        <div className="mt-4 surface-card p-5">
          <div className="mb-3 text-sm font-medium">2 · v1 source</div>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Playbook share URL</label>
              <Input value={playbookUrl} onChange={(e) => setPlaybookUrl(e.target.value)} placeholder="https://playbook.com/s/... or direct .mp4 URL" className="mt-1 h-9" />
              <p className="mt-1 text-[11px] text-muted-foreground">If Playbook resolution fails (auth-gated link), paste the direct .mp4 URL instead.</p>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Change notes (optional)</label>
              <Textarea value={changeNotes} onChange={(e) => setChangeNotes(e.target.value)} rows={2} placeholder="What's special about this cut vs the brief?" className="mt-1" />
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => nav("/prelive")}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Creating…</> : <><Sparkles className="mr-1 h-4 w-4" />Create & run Deep Review</>}
          </Button>
        </div>
      </main>
    </div>
  );
}
