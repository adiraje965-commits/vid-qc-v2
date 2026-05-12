import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Sparkles, Film } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BriefForm } from "@/components/prelive/BriefForm";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { BriefDraft, EMPTY_BRIEF, briefToContextString } from "@/lib/prelive-types";

type PbAsset = { token: string; title: string | null; duration: number | null; mediaType: string | null; thumbnail: string | null };

function withAssetToken(url: string, token: string) {
  try {
    const u = new URL(url);
    u.searchParams.set("assetToken", token);
    return u.toString();
  } catch {
    return `${url}${url.includes("?") ? "&" : "?"}assetToken=${encodeURIComponent(token)}`;
  }
}

export default function PreLiveNew() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [brief, setBrief] = useState<BriefDraft>(EMPTY_BRIEF);
  const [briefPdfPath, setBriefPdfPath] = useState<string | null>(null);
  const [playbookUrl, setPlaybookUrl] = useState("");
  const [changeNotes, setChangeNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [assetChoices, setAssetChoices] = useState<PbAsset[] | null>(null);

  const runResolve = async (url: string) => {
    const { data, error } = await supabase.functions.invoke("resolve-playbook", { body: { url } });
    if (error) throw error;
    return data as
      | { ok: true; directVideoUrl: string; thumbnailUrl: string | null; title: string | null }
      | { ok: false; needsAssetSelection?: boolean; assets?: PbAsset[]; error?: string };
  };

  const finalizeWithResolved = async (sourceUrl: string, resolved: { directVideoUrl: string; thumbnailUrl: string | null; title: string | null }) => {
    // 1. Create asset
    const { data: asset, error: aErr } = await supabase
      .from("prelive_assets")
      .insert({
        owner_id: user?.id ?? null,
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

    const videoUrl = resolved.directVideoUrl;
    const thumbUrl = resolved.thumbnailUrl;
    const title = resolved.title;

    // 2. Create QC task
    const { data: task, error: tErr } = await supabase
      .from("qc_tasks")
      .insert({
        owner_id: user?.id ?? null,
        url: sourceUrl,
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

    // 3. Version row
    const { data: version, error: vErr } = await supabase
      .from("prelive_versions")
      .insert({
        asset_id: asset.id,
        version_label: "v1",
        version_index: 1,
        playbook_url: sourceUrl,
        resolved_video_url: videoUrl,
        resolved_thumbnail_url: thumbUrl,
        change_notes: changeNotes || null,
        qc_task_id: task.id,
        status: "analyzing",
      })
      .select("id")
      .single();
    if (vErr) throw vErr;

    await Promise.all([
      supabase.from("qc_tasks").update({ prelive_version_id: version.id }).eq("id", task.id),
      supabase.from("prelive_assets").update({ latest_version_id: version.id, thumbnail_url: thumbUrl ?? null }).eq("id", asset.id),
    ]);

    const pageContext = briefToContextString(brief, changeNotes);
    void supabase.functions.invoke("deep-video-review", {
      body: { taskId: task.id, videoUrl, pageContext, persona: brief.persona },
    }).then(async ({ error }) => {
      await supabase.from("prelive_versions").update({ status: error ? "failed" : "ready", resolve_error: error?.message ?? null }).eq("id", version.id);
    });

    toast({ title: "Pre-live asset created", description: "Deep Review running in the background." });
    nav(`/prelive/asset/${asset.id}`);
  };

  const submit = async () => {
    if (!brief.campaign_name.trim()) { toast({ title: "Campaign name required", variant: "destructive" }); return; }
    if (!playbookUrl.trim()) { toast({ title: "Playbook URL required", variant: "destructive" }); return; }
    setSubmitting(true);
    setAssetChoices(null);
    try {
      const resolved = await runResolve(playbookUrl);
      if (!resolved.ok) {
        if (resolved.needsAssetSelection && resolved.assets?.length) {
          setAssetChoices(resolved.assets);
          toast({ title: "Pick a video", description: "This board has multiple videos." });
          return;
        }
        throw new Error(resolved.error || "Could not resolve Playbook URL");
      }
      await finalizeWithResolved(playbookUrl, resolved);
    } catch (e) {
      toast({ title: "Couldn't create asset", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const pickAsset = async (asset: PbAsset) => {
    setSubmitting(true);
    try {
      const url = withAssetToken(playbookUrl, asset.token);
      const resolved = await runResolve(url);
      if (!resolved.ok) throw new Error(resolved.error || "Could not resolve selected asset");
      setPlaybookUrl(url);
      setAssetChoices(null);
      await finalizeWithResolved(url, resolved);
    } catch (e) {
      toast({ title: "Couldn't resolve selection", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
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
              <Input value={playbookUrl} onChange={(e) => { setPlaybookUrl(e.target.value); setAssetChoices(null); }} placeholder="https://www.playbook.com/s/<org>/<slug>?assetToken=… or direct .mp4 URL" className="mt-1 h-9" />
              <p className="mt-1 text-[11px] text-muted-foreground">Paste a Playbook share link (board or single-asset). For boards we'll let you pick which cut. Direct .mp4 URLs also work.</p>
            </div>

            {assetChoices && assetChoices.length > 0 && (
              <div className="rounded-md border border-border p-3">
                <div className="mb-2 text-xs font-medium">Pick the video to QC</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {assetChoices.map((a) => (
                    <button
                      key={a.token}
                      type="button"
                      disabled={submitting}
                      onClick={() => pickAsset(a)}
                      className="group flex flex-col gap-1 rounded-md border border-border bg-background p-2 text-left transition hover:border-primary disabled:opacity-50"
                    >
                      <div className="relative aspect-video w-full overflow-hidden rounded bg-muted">
                        {a.thumbnail ? (
                          <img src={a.thumbnail} alt={a.title ?? "asset"} className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground"><Film className="h-5 w-5" /></div>
                        )}
                        {a.duration != null && (
                          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{Math.round(a.duration)}s</span>
                        )}
                      </div>
                      <div className="line-clamp-2 text-xs">{a.title ?? a.token}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

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
