import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { FileVideo, Loader2, Plus } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { scoreColor } from "@/lib/qc-types";

interface AssetRow {
  id: string;
  campaign_name: string;
  business_key: string | null;
  channel: string | null;
  thumbnail_url: string | null;
  updated_at: string;
  latest_version_id: string | null;
  versions: { id: string; version_label: string; status: string; qc_task_id: string | null; resolved_thumbnail_url: string | null }[];
}

export default function PreLiveList() {
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scores, setScores] = useState<Record<string, number | null>>({});

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("prelive_assets")
        .select("id,campaign_name,business_key,channel,thumbnail_url,updated_at,latest_version_id,prelive_versions(id,version_label,status,qc_task_id,resolved_thumbnail_url)")
        .order("updated_at", { ascending: false });
      if (!error && data) {
        const list = (data as any[]).map((r) => ({ ...r, versions: r.prelive_versions ?? [] })) as AssetRow[];
        setRows(list);
        const taskIds = list.flatMap((r) => r.versions.map((v) => v.qc_task_id).filter(Boolean)) as string[];
        if (taskIds.length) {
          const { data: tasks } = await supabase.from("qc_tasks").select("id,overall_score").in("id", taskIds);
          const map: Record<string, number | null> = {};
          (tasks ?? []).forEach((t: any) => { map[t.id] = t.overall_score; });
          setScores(map);
        }
      }
      setLoading(false);
    };
    load();
    const ch = supabase.channel("prelive_list")
      .on("postgres_changes", { event: "*", schema: "public", table: "prelive_assets" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "prelive_versions" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-[1600px] px-6 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pre-Live QC</h1>
            <p className="mt-1 text-sm text-muted-foreground">QC draft cuts before they go live. Sourced from Playbook share links. Multiple versions per asset, with diffs.</p>
          </div>
          <Button asChild><Link to="/prelive/new"><Plus className="mr-1 h-4 w-4" />New pre-live asset</Link></Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
        ) : rows.length === 0 ? (
          <div className="surface-card flex flex-col items-center gap-3 p-10 text-center">
            <FileVideo className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">No pre-live assets yet</div>
            <p className="max-w-md text-xs text-muted-foreground">Paste a Playbook share link and a brief to QC a draft cut. Add new versions as the editor revises — we'll show you what was fixed, what regressed, and what's new.</p>
            <Button asChild><Link to="/prelive/new"><Plus className="mr-1 h-4 w-4" />Create the first one</Link></Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => {
              const latest = r.versions.find((v) => v.id === r.latest_version_id) ?? r.versions[r.versions.length - 1];
              const latestScore = latest?.qc_task_id ? scores[latest.qc_task_id] : null;
              return (
                <Link key={r.id} to={`/prelive/asset/${r.id}`} className="surface-card group overflow-hidden p-0 transition hover:ring-1 hover:ring-primary/40">
                  <div className="aspect-video w-full overflow-hidden bg-secondary/30">
                    {(latest?.resolved_thumbnail_url || r.thumbnail_url) ? (
                      <img src={latest?.resolved_thumbnail_url || r.thumbnail_url || ""} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
                    ) : <div className="flex h-full w-full items-center justify-center text-muted-foreground"><FileVideo className="h-8 w-8" /></div>}
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium leading-tight">{r.campaign_name}</div>
                      {latestScore != null && <div className={`text-lg font-semibold ${scoreColor(latestScore)}`}>{latestScore}</div>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {r.business_key && <Badge variant="outline" className="border-white/10">{r.business_key}</Badge>}
                      {r.channel && <Badge variant="outline" className="border-white/10">{r.channel}</Badge>}
                      <Badge variant="outline" className="border-primary/30 text-primary">{r.versions.length} version{r.versions.length === 1 ? "" : "s"}</Badge>
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">Updated {formatDistanceToNow(new Date(r.updated_at), { addSuffix: true })}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
