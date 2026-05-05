import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { QcTask, scoreColor } from "@/lib/qc-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, FileVideo2, Loader2, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Dashboard() {
  const [tasks, setTasks] = useState<QcTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("qc_tasks").select("*").order("created_at", { ascending: false }).limit(200);
      setTasks((data ?? []) as unknown as QcTask[]);
      setLoading(false);
    };
    load();
    const ch = supabase
      .channel("qc_tasks_dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "qc_tasks" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const stats = {
    total: tasks.length,
    processing: tasks.filter((t) => t.status === "processing").length,
    avg: tasks.filter((t) => t.overall_score != null).reduce((a, t) => a + (t.overall_score ?? 0), 0) /
      Math.max(1, tasks.filter((t) => t.overall_score != null).length),
    critical: tasks.reduce((a, t) => a + (t.critical_count ?? 0), 0),
  };

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-[1600px] px-6 py-8">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">QC Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              URL-first quality control for Bajaj Finance marketing videos.
            </p>
          </div>
          <Link to="/new">
            <Button size="lg" className="gap-2 shadow-[0_8px_30px_-10px_hsl(var(--primary)/0.6)]">
              <Plus className="h-4 w-4" /> New Analysis
            </Button>
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total Tasks" value={stats.total} />
          <StatCard label="Processing" value={stats.processing} accent />
          <StatCard label="Avg Score" value={isFinite(stats.avg) ? Math.round(stats.avg) : "—"} suffix="/100" />
          <StatCard label="Critical Issues" value={stats.critical} tone="bad" />
        </div>

        <section className="surface-card mt-6 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
            <div className="text-sm font-medium">Recent Tasks</div>
            <div className="text-xs text-muted-foreground">{tasks.length} total</div>
          </div>
          <div className="divide-y divide-border/60">
            <div className="grid grid-cols-[80px_1.2fr_2fr_120px_120px_140px_60px] gap-3 px-5 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <div>Preview</div><div>Task</div><div>URL</div><div>Score</div><div>Severity</div><div>Date</div><div></div>
            </div>
            {loading && (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading tasks…
              </div>
            )}
            {!loading && tasks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <FileVideo2 className="h-10 w-10 text-muted-foreground/60" />
                <p className="mt-3 text-sm text-muted-foreground">No tasks yet. Run your first QC analysis.</p>
                <Link to="/new" className="mt-4">
                  <Button>Start New Analysis</Button>
                </Link>
              </div>
            )}
            {tasks.map((t) => (
              <Link
                to={`/task/${t.id}`}
                key={t.id}
                className="group grid grid-cols-[80px_1.2fr_2fr_120px_120px_140px_60px] items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-secondary/50"
              >
                <div className="relative h-12 w-20 overflow-hidden rounded-md bg-muted ring-1 ring-border">
                  {t.thumbnail_url ? (
                    <img src={t.thumbnail_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <FileVideo2 className="h-5 w-5 text-muted-foreground/60" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{t.page_title ?? "Untitled page"}</div>
                  <div className="text-[11px] text-muted-foreground">#{t.id.slice(0, 8)}</div>
                </div>
                <div className="truncate text-muted-foreground">{t.url}</div>
                <div>
                  {t.status === "processing" ? (
                    <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                      <Loader2 className="h-3 w-3 animate-spin" /> Processing
                    </Badge>
                  ) : t.status === "failed" ? (
                    <Badge variant="outline" className="border-severity-critical/40 text-severity-critical">Failed</Badge>
                  ) : (
                    <span className={`text-base font-semibold ${scoreColor(t.overall_score)}`}>{t.overall_score}<span className="text-xs text-muted-foreground">/100</span></span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  {t.critical_count > 0 && <SevPill n={t.critical_count} cls="bg-severity-critical/20 text-severity-critical" />}
                  {t.high_count > 0 && <SevPill n={t.high_count} cls="bg-severity-high/20 text-severity-high" />}
                  {t.medium_count > 0 && <SevPill n={t.medium_count} cls="bg-severity-medium/20 text-severity-medium" />}
                  {t.low_count > 0 && <SevPill n={t.low_count} cls="bg-severity-low/20 text-severity-low" />}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                </div>
                <div className="flex justify-end">
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function StatCard({ label, value, suffix, accent, tone }: { label: string; value: number | string; suffix?: string; accent?: boolean; tone?: "bad" }) {
  return (
    <div className="surface-card p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${accent ? "text-primary" : tone === "bad" ? "text-severity-critical" : ""}`}>
        {value}{suffix && <span className="ml-1 text-base text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
function SevPill({ n, cls }: { n: number; cls: string }) {
  return <span className={`rounded-md px-1.5 py-0.5 font-medium ${cls}`}>{n}</span>;
}
