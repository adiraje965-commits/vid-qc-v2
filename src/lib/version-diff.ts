import type { QcIssue } from "@/lib/qc-types";

const SEV_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

function normalize(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function similarity(a: string, b: string) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const setA = new Set(a.split(" "));
  const setB = new Set(b.split(" "));
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  return inter / Math.max(setA.size, setB.size);
}

function matches(x: QcIssue, y: QcIssue) {
  if (x.bucket !== y.bucket) return false;
  if (x.criterion && y.criterion && x.criterion !== y.criterion) return false;
  const sim = similarity(normalize(x.title), normalize(y.title));
  if (sim >= 0.6) return true;
  if (x.timestamp_sec != null && y.timestamp_sec != null && Math.abs(x.timestamp_sec - y.timestamp_sec) <= 3 && sim >= 0.35) return true;
  return false;
}

export interface IssueDiff {
  fixed: QcIssue[];
  regressed: { from: QcIssue; to: QcIssue }[];
  unchanged: { from: QcIssue; to: QcIssue }[];
  added: QcIssue[];
}

export function diffIssues(prev: QcIssue[], next: QcIssue[]): IssueDiff {
  const usedNext = new Set<string>();
  const fixed: QcIssue[] = [];
  const regressed: { from: QcIssue; to: QcIssue }[] = [];
  const unchanged: { from: QcIssue; to: QcIssue }[] = [];

  for (const p of prev) {
    const m = next.find((n) => !usedNext.has(n.id) && matches(p, n));
    if (!m) { fixed.push(p); continue; }
    usedNext.add(m.id);
    if ((SEV_ORDER[m.severity] ?? 0) > (SEV_ORDER[p.severity] ?? 0)) regressed.push({ from: p, to: m });
    else unchanged.push({ from: p, to: m });
  }
  const added = next.filter((n) => !usedNext.has(n.id));
  return { fixed, regressed, unchanged, added };
}
