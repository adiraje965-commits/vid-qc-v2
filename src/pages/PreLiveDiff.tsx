import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, MinusCircle, PlusCircle, TrendingDown, TrendingUp } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { QcIssue, scoreColor, severityClass, BUCKET_LABEL } from "@/lib/qc-types";
import { diffIssues } from "@/lib/version-diff";
import { ExportMenu } from "@/components/ExportMenu";
import { exportDiffPdf } from "@/lib/qc-export";

interface VersionRef { id: string; version_label: string; resolved_thumbnail_url: string | null; qc_task_id: string | null; }
interface TaskScores { overall_score: number | null; technical_score: number | null; brand_score: number | null; strategic_score: number | null; contextual_score: number | null; }

export default function PreLiveDiff() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const fromId = params.get("from") ?? "";
  const toId = params.get("to") ?? "";

  const [from, setFrom] = useState<VersionRef | null>(null);
  const [to, setTo] = useState<VersionRef | null>(null);
  const [fromTask, setFromTask] = useState<TaskScores | null>(null);
  const [toTask, setToTask] = useState<TaskScores | null>(null);
  const [fromIssues, setFromIssues] = useState<QcIssue[]>([]);
  const [toIssues, setToIssues] = useState<QcIssue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!fromId || !toId) { setLoading(false); return; }
      const { data: vs } = await supabase.from("prelive_versions").select("id,version_label,resolved_thumbnail_url,qc_task_id").in("id", [fromId, toId]);
      const f = (vs ?? []).find((v: any) => v.id === fromId) as VersionRef | undefined;
      const t = (vs ?? []).find((v: any) => v.id === toId) as VersionRef | undefined;
      setFrom(f ?? null); setTo(t ?? null);
      const taskIds = [f?.qc_task_id, t?.qc_task_id].filter(Boolean) as string[];
      if (taskIds.length === 2) {
        const [{ data: tasks }, { data: issues }] = await Promise.all([
          supabase.from("qc_tasks").select("id,overall_score,technical_score,brand_score,strategic_score,contextual_score").in("id", taskIds),
          supabase.from("qc_issues").select("*").in("task_id", taskIds),
        ]);
        const tMap: Record<string, TaskScores> = {};
        (tasks ?? []).forEach((x: any) => { tMap[x.id] = x; });
        setFromTask(tMap[f!.qc_task_id!] ?? null);
        setToTask(tMap[t!.qc_task_id!] ?? null);
        setFromIssues((issues ?? []).filter((i: any) => i.task_id === f!.qc_task_id) as QcIssue[]);
        setToIssues((issues ?? []).filter((i: any) => i.task_id === t!.qc_task_id) as QcIssue[]);
      }
      setLoading(false);
    };
    load();
  }, [fromId, toId]);

  const diff = useMemo(() => diffIssues(fromIssues, toIssues), [fromIssues, toIssues]);

  if (loading) return <div className="min-h-screen"><AppHeader /><div className="p-8 text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Loading…</div></div>;
  if (!from || !to) return <div className="min-h-screen"><AppHeader /><div className="p-8 text-sm">Versions not found.</div></div>;

  const buckets: Array<keyof typeof BUCKET_LABEL> = ["technical", "brand", "strategic", "contextual"];
  const delta = (a: number | null, b: number | null) => (a == null || b == null ? null : b - a);

  const ScoreCell = ({ a, b, label }: { a: number | null; b: number | null; label: string }) => {
    const d = delta(a, b);
    return (
      <div className="rounded-md border border-white/8 bg-secondary/20 p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className={`text-lg font-semibold ${scoreColor(a)}`}>{a ?? "—"}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className={`text-lg font-semibold ${scoreColor(b)}`}>{b ?? "—"}</span>
          {d != null && d !== 0 && (
            <span className={`ml-auto inline-flex items-center text-xs font-medium ${d > 0 ? "text-score-good" : "text-score-bad"}`}>
              {d > 0 ? <TrendingUp className="mr-0.5 h-3 w-3" /> : <TrendingDown className="mr-0.5 h-3 w-3" />}
              {d > 0 ? "+" : ""}{d}
            </span>
          )}
        </div>
      </div>
    );
  };

  const Issue = ({ i }: { i: QcIssue }) => (
    <div className="rounded-md border border-white/8 bg-secondary/15 p-2.5">
      <div className="flex items-start gap-2">
        <Badge variant="outline" className={`shrink-0 text-[10px] ${severityClass(i.severity)}`}>{i.severity}</Badge>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium leading-tight">{i.title}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {BUCKET_LABEL[i.bucket]}{i.criterion ? ` · ${i.criterion}` : ""}{i.timestamp_sec != null ? ` · @${Math.round(i.timestamp_sec)}s` : ""}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-[1500px] px-6 py-8">
        <Button variant="ghost" size="sm" asChild className="mb-4"><Link to={`/prelive/asset/${id}`}><ArrowLeft className="mr-1 h-4 w-4" />Asset</Link></Button>
        <h1 className="text-2xl font-semibold tracking-tight">Diff: {from.version_label} → {to.version_label}</h1>

        <div className="mt-5 grid gap-3 sm:grid-cols-5">
          <ScoreCell label="Overall" a={fromTask?.overall_score ?? null} b={toTask?.overall_score ?? null} />
          {buckets.map((bk) => (
            <ScoreCell key={bk} label={BUCKET_LABEL[bk]} a={(fromTask as any)?.[`${bk}_score`] ?? null} b={(toTask as any)?.[`${bk}_score`] ?? null} />
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="surface-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-score-good">
              <MinusCircle className="h-4 w-4" />Fixed ({diff.fixed.length})
            </div>
            <div className="space-y-2">
              {diff.fixed.length === 0 && <div className="text-xs text-muted-foreground">Nothing fixed yet.</div>}
              {diff.fixed.map((i) => <Issue key={i.id} i={i} />)}
            </div>
          </div>

          <div className="surface-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-severity-high">
              <TrendingDown className="h-4 w-4" />Regressed ({diff.regressed.length})
            </div>
            <div className="space-y-2">
              {diff.regressed.length === 0 && <div className="text-xs text-muted-foreground">No regressions.</div>}
              {diff.regressed.map(({ from: f, to: t }) => (
                <div key={t.id} className="rounded-md border border-severity-high/30 bg-severity-high/5 p-2.5">
                  <div className="text-xs font-medium">{t.title}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{BUCKET_LABEL[t.bucket]} · severity {f.severity} → <span className="text-severity-high">{t.severity}</span></div>
                </div>
              ))}
            </div>
          </div>

          <div className="surface-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
              <PlusCircle className="h-4 w-4" />New ({diff.added.length})
            </div>
            <div className="space-y-2">
              {diff.added.length === 0 && <div className="text-xs text-muted-foreground">No new issues.</div>}
              {diff.added.map((i) => <Issue key={i.id} i={i} />)}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <ExportMenu
            label="Export diff"
            onPdf={() => exportDiffPdf({
              campaignName: `${from.version_label} vs ${to.version_label}`,
              fromLabel: from.version_label,
              toLabel: to.version_label,
              fromScores: {
                overall: fromTask?.overall_score ?? null, technical: fromTask?.technical_score ?? null,
                brand: fromTask?.brand_score ?? null, strategic: fromTask?.strategic_score ?? null, contextual: fromTask?.contextual_score ?? null,
              },
              toScores: {
                overall: toTask?.overall_score ?? null, technical: toTask?.technical_score ?? null,
                brand: toTask?.brand_score ?? null, strategic: toTask?.strategic_score ?? null, contextual: toTask?.contextual_score ?? null,
              },
              diff,
            })}
          />
          {from.qc_task_id && <Button asChild size="sm" variant="outline"><Link to={`/task/${from.qc_task_id}`}>Open {from.version_label}</Link></Button>}
          {to.qc_task_id && <Button asChild size="sm" variant="outline"><Link to={`/task/${to.qc_task_id}`}>Open {to.version_label}</Link></Button>}
        </div>
      </main>
    </div>
  );
}
