import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { supabase } from "@/integrations/supabase/client";
import { LineChart as ReLine, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
import { Loader2, TrendingUp } from "lucide-react";

interface Task { id: string; created_at: string; overall_score: number | null; technical_score: number | null; brand_score: number | null; strategic_score: number | null; contextual_score: number | null; critical_count: number; high_count: number; tags: string[] }
interface Issue { bucket: string; severity: string; title: string }

export default function Trends() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [{ data: t }, { data: i }] = await Promise.all([
        supabase.from("qc_tasks").select("id,created_at,overall_score,technical_score,brand_score,strategic_score,contextual_score,critical_count,high_count,tags").order("created_at", { ascending: true }).limit(500),
        supabase.from("qc_issues").select("bucket,severity,title").limit(2000),
      ]);
      setTasks((t ?? []) as Task[]);
      setIssues((i ?? []) as Issue[]);
      setLoading(false);
    }
    load();
  }, []);

  const scoreSeries = useMemo(() => tasks.filter((t) => t.overall_score != null).map((t) => ({
    date: new Date(t.created_at).toLocaleDateString(),
    overall: t.overall_score, brand: t.brand_score, technical: t.technical_score, strategic: t.strategic_score, contextual: t.contextual_score,
  })), [tasks]);

  const topIssues = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues) m.set(i.title, (m.get(i.title) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([title, count]) => ({ title: title.length > 50 ? title.slice(0, 50) + "…" : title, count }));
  }, [issues]);

  const bucketSummary = useMemo(() => {
    const m: Record<string, number> = { technical: 0, brand: 0, strategic: 0, contextual: 0 };
    for (const i of issues) m[i.bucket] = (m[i.bucket] ?? 0) + 1;
    return Object.entries(m).map(([bucket, count]) => ({ bucket, count }));
  }, [issues]);

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-6 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /><h1 className="text-2xl font-semibold">Trends</h1></div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-6">
            <div className="surface-card p-5">
              <div className="mb-3 text-sm font-medium">Scores Over Time ({scoreSeries.length} tasks)</div>
              {scoreSeries.length === 0 ? <p className="text-sm text-muted-foreground">No scored tasks yet.</p> : (
                <div className="h-72">
                  <ResponsiveContainer>
                    <ReLine data={scoreSeries}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Line type="monotone" dataKey="overall" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="brand" stroke="hsl(var(--score-good))" strokeWidth={1} dot={false} />
                      <Line type="monotone" dataKey="technical" stroke="hsl(var(--score-warn))" strokeWidth={1} dot={false} />
                    </ReLine>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="surface-card p-5">
                <div className="mb-3 text-sm font-medium">Issues by Bucket</div>
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={bucketSummary}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                      <XAxis dataKey="bucket" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Bar dataKey="count" fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="surface-card p-5">
                <div className="mb-3 text-sm font-medium">Top 10 Recurring Issues</div>
                {topIssues.length === 0 ? <p className="text-sm text-muted-foreground">No issues yet.</p> : (
                  <ul className="space-y-1.5 text-sm">
                    {topIssues.map((t, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/20 px-3 py-2">
                        <span className="truncate">{t.title}</span>
                        <span className="shrink-0 rounded bg-severity-high/15 px-2 py-0.5 text-xs font-medium text-severity-high">{t.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
