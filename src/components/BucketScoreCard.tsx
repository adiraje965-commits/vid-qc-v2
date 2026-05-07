import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { BUCKET_LABEL, QcIssue, scoreColor, severityClass } from "@/lib/qc-types";
import { BucketBreakdown, BucketKey, getBucket } from "@/lib/qc-rubric";
import type { LucideIcon } from "lucide-react";

interface Props {
  bucketKey: BucketKey;
  icon: LucideIcon;
  weight: number;
  score: number | null;
  breakdown: BucketBreakdown | null | undefined;
  issues: QcIssue[];
  onSeek: (t: number) => void;
}

export function BucketScoreCard({ bucketKey, icon: Icon, weight, score, breakdown, issues, onSeek }: Props) {
  const def = getBucket(bucketKey);
  const entry = breakdown?.[bucketKey];
  const criteria = entry?.criteria ?? {};

  const issuesByCriterion = useMemo(() => {
    const m: Record<string, QcIssue[]> = {};
    for (const i of issues) {
      const k = i.criterion ?? "_other";
      (m[k] ||= []).push(i);
    }
    return m;
  }, [issues]);

  const safeScore = score ?? 0;

  return (
    <AccordionItem value={bucketKey} className="overflow-hidden rounded-lg border border-border bg-secondary/30">
      <AccordionTrigger className="px-3 py-2.5 hover:no-underline">
        <div className="flex w-full items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div>
          <div className="flex-1 text-left">
            <div className="text-sm font-medium">{BUCKET_LABEL[bucketKey]}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Weight {weight}% · {def.criteria.length} criteria</div>
          </div>
          <div className={`text-lg font-semibold ${scoreColor(score)}`}>{score ?? "—"}</div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-3">
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div className={`h-full ${safeScore >= 80 ? "bg-score-good" : safeScore >= 60 ? "bg-score-warn" : "bg-score-bad"}`} style={{ width: `${safeScore}%` }} />
        </div>

        {/* Sub-criteria */}
        <div className="mb-3 space-y-2">
          {def.criteria.map((c) => {
            const v = criteria[c.key];
            const cs = v?.score ?? null;
            const list = issuesByCriterion[c.key] ?? [];
            return (
              <details key={c.key} className="group rounded-md border border-border bg-card/40 p-2 text-xs">
                <summary className="flex cursor-pointer items-center gap-2 list-none">
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-medium">{c.label}</span>
                      <Badge variant="outline" className="border-primary/30 bg-primary/5 px-1 py-0 text-[9px] font-normal text-primary">{c.standard}</Badge>
                      {list.length > 0 && (
                        <Badge variant="outline" className="border-severity-high/30 px-1 py-0 text-[9px] text-severity-high">{list.length}</Badge>
                      )}
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border">
                      <div className={`h-full ${cs == null ? "bg-muted" : cs >= 80 ? "bg-score-good" : cs >= 60 ? "bg-score-warn" : "bg-score-bad"}`} style={{ width: `${cs ?? 0}%` }} />
                    </div>
                  </div>
                  <div className={`shrink-0 text-sm font-semibold tabular-nums ${scoreColor(cs)}`}>{cs ?? "—"}</div>
                </summary>
                {v?.rationale && (
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{v.rationale}</p>
                )}
                {list.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {list.map((i) => (
                      <li key={i.id} className="rounded border border-border/70 bg-background/60 p-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-[11px] font-medium">{i.title}</div>
                          <Badge variant="outline" className={`shrink-0 text-[9px] uppercase ${severityClass(i.severity)}`}>{i.severity}</Badge>
                        </div>
                        {i.timestamp_sec != null && (
                          <button onClick={() => onSeek(i.timestamp_sec ?? 0)} className="mt-0.5 text-[10px] text-primary hover:underline">@ {Math.round(i.timestamp_sec)}s</button>
                        )}
                        {i.suggested_fix && (
                          <p className="mt-1 rounded border-l-2 border-primary/50 bg-primary/5 p-1 text-[10px] text-foreground/90"><span className="font-medium text-primary">Fix:</span> {i.suggested_fix}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            );
          })}
        </div>

        {/* Unattributed (legacy) issues */}
        {(issuesByCriterion["_other"]?.length ?? 0) > 0 && (
          <div className="mt-2 rounded-md border border-dashed border-border p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Other issues in this bucket</div>
            <ul className="space-y-1.5">
              {issuesByCriterion["_other"].map((i) => (
                <li key={i.id} className="text-[11px]">
                  <span className="font-medium">{i.title}</span>
                  {i.timestamp_sec != null && (
                    <button onClick={() => onSeek(i.timestamp_sec ?? 0)} className="ml-2 text-primary hover:underline">@ {Math.round(i.timestamp_sec)}s</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
