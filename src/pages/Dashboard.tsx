import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, DatabaseZap, FileVideo2, Gauge, Loader2, Plus, ShieldAlert, Sparkles, Timer } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { listLocalTasks, subscribeLocalQc } from "@/lib/local-qc";
import { QcTask, scoreColor } from "@/lib/qc-types";

export default function Dashboard() {
  const [tasks, setTasks] = useState<QcTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setTasks(listLocalTasks());
      const { data, error } = await withTimeout(
        supabase.from("qc_tasks").select("*").order("created_at", { ascending: false }).limit(200),
        5000,
      );
      const remoteTasks = error ? [] : ((data ?? []) as unknown as QcTask[]);
      const merged = [...listLocalTasks(), ...remoteTasks].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
      setTasks(merged);
      setLoading(false);
    };
    load();
    const unsubLocal = subscribeLocalQc(load);
    const ch = supabase
      .channel("qc_tasks_dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "qc_tasks" }, () => load())
      .subscribe();
    return () => { unsubLocal(); supabase.removeChannel(ch); };
  }, []);

  const scored = tasks.filter((task) => task.overall_score != null);
  const stats = {
    total: tasks.length,
    processing: tasks.filter((task) => task.status === "processing").length,
    avg: scored.reduce((sum, task) => sum + (task.overall_score ?? 0), 0) / Math.max(1, scored.length),
    critical: tasks.reduce((sum, task) => sum + (task.critical_count ?? 0), 0),
  };

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-[1600px] px-6 py-8">
        <section className="workstation-panel soft-grid overflow-hidden p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                <Sparkles className="h-3.5 w-3.5" /> Bajaj Finance video command center
              </div>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight">QC Dashboard</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Scan URLs, review detected videos, track transcript coverage, and spot critical brand or compliance failures before publish.
              </p>
            </div>
            <Link to="/new">
              <Button size="lg" className="gap-2 shadow-[0_18px_50px_-22px_hsl(var(--primary))]">
                <Plus className="h-4 w-4" /> New Analysis
              </Button>
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={FileVideo2} label="Total Tasks" value={stats.total} hint="all scanned videos" />
            <StatCard icon={Timer} label="Processing" value={stats.processing} hint="live jobs" accent />
            <StatCard icon={Gauge} label="Avg Score" value={isFinite(stats.avg) ? Math.round(stats.avg) : 0} suffix="/100" hint={`${scored.length} scored`} />
            <StatCard icon={ShieldAlert} label="Critical Issues" value={stats.critical} hint="must fix" tone="bad" />
          </div>
        </section>

        <section className="surface-card mt-6 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div>
              <div className="text-sm font-medium">Recent Tasks</div>
              <div className="text-xs text-muted-foreground">{tasks.length} total analyses across cloud and local fallback</div>
            </div>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              Live sync
            </Badge>
          </div>
          <div className="divide-y divide-border/60">
            <div className="hidden grid-cols-[88px_1.15fr_1.8fr_130px_140px_150px_52px] gap-3 px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground lg:grid">
              <div>Preview</div><div>Task</div><div>URL</div><div>Score</div><div>Severity</div><div>Date</div><div></div>
            </div>
            {loading && (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading tasks...
              </div>
            )}
            {!loading && tasks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-border bg-secondary/40">
                  <FileVideo2 className="h-7 w-7 text-muted-foreground/70" />
                </div>
                <p className="mt-4 text-sm text-muted-foreground">No tasks yet. Run your first QC analysis.</p>
                <Link to="/new" className="mt-4">
                  <Button>Start New Analysis</Button>
                </Link>
              </div>
            )}
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function TaskRow({ task }: { task: QcTask }) {
  return (
    <Link
      to={`/task/${task.id}`}
      className="group grid gap-3 px-5 py-4 text-sm transition hover:bg-secondary/45 lg:grid-cols-[88px_1.15fr_1.8fr_130px_140px_150px_52px] lg:items-center"
    >
      <div className="relative hidden h-14 w-[88px] overflow-hidden rounded-md bg-muted ring-1 ring-border lg:block">
        {task.thumbnail_url ? (
          <img src={task.thumbnail_url} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <FileVideo2 className="h-5 w-5 text-muted-foreground/60" />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate font-medium">{task.page_title ?? "Untitled page"}</div>
          {task.id.startsWith("local_") && (
            <Badge variant="outline" className="gap-1 border-score-warn/40 text-score-warn">
              <DatabaseZap className="h-3 w-3" /> Local
            </Badge>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">#{task.id.slice(0, 12)}</div>
      </div>
      <div className="truncate text-muted-foreground">{task.url}</div>
      <div>
        {task.status === "processing" ? (
          <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
            <Loader2 className="h-3 w-3 animate-spin" /> Processing
          </Badge>
        ) : task.status === "failed" ? (
          <Badge variant="outline" className="border-severity-critical/40 text-severity-critical">Failed</Badge>
        ) : (
          <span className={`text-lg font-semibold ${scoreColor(task.overall_score)}`}>{task.overall_score}<span className="text-xs text-muted-foreground">/100</span></span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-[11px]">
        {task.critical_count > 0 && <SevPill n={task.critical_count} cls="bg-severity-critical/20 text-severity-critical" />}
        {task.high_count > 0 && <SevPill n={task.high_count} cls="bg-severity-high/20 text-severity-high" />}
        {task.medium_count > 0 && <SevPill n={task.medium_count} cls="bg-severity-medium/20 text-severity-medium" />}
        {task.low_count > 0 && <SevPill n={task.low_count} cls="bg-severity-low/20 text-severity-low" />}
        {!task.critical_count && !task.high_count && !task.medium_count && !task.low_count && (
          <span className="text-muted-foreground">None</span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
      </div>
      <div className="hidden justify-end lg:flex">
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>
    </Link>
  );
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T | { data: null; error: Error }> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<{ data: null; error: Error }>((resolve) => {
      window.setTimeout(() => resolve({ data: null, error: new Error("Supabase request timed out") }), timeoutMs);
    }),
  ]);
}

function StatCard({ icon: Icon, label, value, suffix, hint, accent, tone }: {
  icon: typeof FileVideo2;
  label: string;
  value: number | string;
  suffix?: string;
  hint: string;
  accent?: boolean;
  tone?: "bad";
}) {
  return (
    <div className="metric-panel p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon className={`h-4 w-4 ${accent ? "text-primary" : tone === "bad" ? "text-severity-critical" : "text-muted-foreground"}`} />
      </div>
      <div className={`mt-3 text-3xl font-semibold ${accent ? "text-primary" : tone === "bad" ? "text-severity-critical" : ""}`}>
        {value}{suffix && <span className="ml-1 text-base text-muted-foreground">{suffix}</span>}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function SevPill({ n, cls }: { n: number; cls: string }) {
  return <span className={`rounded-md px-1.5 py-0.5 font-medium ${cls}`}>{n}</span>;
}
