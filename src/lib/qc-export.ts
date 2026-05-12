import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { QcIssue, QcTask, KeyFrame } from "@/lib/qc-types";
import { BUCKET_LABEL } from "@/lib/qc-types";
import type { IssueDiff } from "@/lib/version-diff";

function slug(s: string | null | undefined) {
  return (s || "qc-report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
function today() { return new Date().toISOString().slice(0, 10); }
function fmtScore(n: number | null | undefined) { return n == null ? "—" : String(n); }

interface ExtraContext {
  kind?: "live" | "prelive";
  versionLabel?: string;
  brief?: {
    persona?: string | null;
    channel?: string | null;
    aspect_ratio?: string | null;
    target_runtime_sec?: number | null;
    languages?: string[];
    key_claims?: string[];
    mandatory_disclaimers?: string[];
    notes?: string | null;
    change_notes?: string | null;
  };
}

export function exportTaskPdf(task: QcTask, issues: QcIssue[], extra: ExtraContext = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  // Header
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(task.page_title || "Untitled", margin, y);
  y += 22;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110);
  const meta: string[] = [];
  if (extra.kind === "prelive") meta.push(`Pre-Live${extra.versionLabel ? ` · ${extra.versionLabel}` : ""}`);
  else meta.push("Live QC");
  meta.push(`Generated ${new Date().toLocaleString()}`);
  doc.text(meta.join("  ·  "), margin, y);
  y += 14;
  if (task.url) {
    const url = doc.splitTextToSize(task.url, pageW - margin * 2);
    doc.text(url, margin, y);
    y += url.length * 11;
  }
  doc.setTextColor(0);
  y += 8;

  // Score block
  autoTable(doc, {
    startY: y,
    theme: "grid",
    head: [["Overall", "Technical (25%)", "Brand (30%)", "Strategic (20%)", "Contextual (25%)"]],
    body: [[
      fmtScore(task.overall_score),
      fmtScore(task.technical_score),
      fmtScore(task.brand_score),
      fmtScore(task.strategic_score),
      fmtScore(task.contextual_score),
    ]],
    headStyles: { fillColor: [30, 30, 35], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 12, halign: "center", fontStyle: "bold" },
    margin: { left: margin, right: margin },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // Severity counts
  autoTable(doc, {
    startY: y,
    theme: "grid",
    head: [["Critical", "High", "Medium", "Low", "Total"]],
    body: [[
      String(task.critical_count ?? 0),
      String(task.high_count ?? 0),
      String(task.medium_count ?? 0),
      String(task.low_count ?? 0),
      String(issues.length),
    ]],
    headStyles: { fillColor: [60, 60, 70], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 11, halign: "center" },
    margin: { left: margin, right: margin },
  });
  y = (doc as any).lastAutoTable.finalY + 14;

  // Summary
  if (task.analysis_summary) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("Analysis Summary", margin, y); y += 14;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const lines = doc.splitTextToSize(task.analysis_summary, pageW - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 12 + 8;
  }
  if (task.customer_intent) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("Customer Intent: ", margin, y);
    doc.setFont("helvetica", "normal");
    const txt = doc.splitTextToSize(task.customer_intent, pageW - margin * 2 - 90);
    doc.text(txt, margin + 90, y);
    y += Math.max(12, txt.length * 12) + 6;
  }

  // Brief context (pre-live)
  if (extra.kind === "prelive" && extra.brief) {
    if (y > 700) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("Brief Context", margin, y); y += 12;
    const b = extra.brief;
    const rows: [string, string][] = [];
    if (b.persona) rows.push(["Persona", b.persona]);
    if (b.channel) rows.push(["Channel", b.channel]);
    if (b.aspect_ratio) rows.push(["Aspect ratio", b.aspect_ratio]);
    if (b.target_runtime_sec) rows.push(["Target runtime", `${b.target_runtime_sec}s`]);
    if (b.languages?.length) rows.push(["Languages", b.languages.join(", ")]);
    if (b.key_claims?.length) rows.push(["Key claims", b.key_claims.join(" • ")]);
    if (b.mandatory_disclaimers?.length) rows.push(["Mandatory disclaimers", b.mandatory_disclaimers.join(" • ")]);
    if (b.notes) rows.push(["Notes", b.notes]);
    if (b.change_notes) rows.push(["Change notes", b.change_notes]);
    if (rows.length) {
      autoTable(doc, {
        startY: y, theme: "plain", body: rows,
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 110, textColor: 90 }, 1: { cellWidth: pageW - margin * 2 - 110 } },
        margin: { left: margin, right: margin },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }
  }

  // Issues by bucket
  const buckets: Array<keyof typeof BUCKET_LABEL> = ["technical", "brand", "strategic", "contextual"];
  const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  for (const bk of buckets) {
    const list = issues.filter((i) => i.bucket === bk).sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));
    if (!list.length) continue;
    if (y > 720) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(`${BUCKET_LABEL[bk]} Issues (${list.length})`, margin, y); y += 6;
    autoTable(doc, {
      startY: y + 4,
      head: [["Sev", "@", "Issue", "Suggested fix"]],
      body: list.map((i) => [
        i.severity.toUpperCase(),
        i.timestamp_sec != null ? `${Math.round(i.timestamp_sec)}s` : "—",
        i.title + (i.description ? `\n${i.description}` : ""),
        i.suggested_fix || "—",
      ]),
      headStyles: { fillColor: [40, 40, 50], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8.5, valign: "top" },
      columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 36, halign: "center" }, 2: { cellWidth: 240 }, 3: { cellWidth: "auto" } },
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 0) {
          const sev = (list[data.row.index]?.severity ?? "low") as string;
          const colors: Record<string, [number, number, number]> = {
            critical: [220, 38, 38], high: [234, 88, 12], medium: [202, 138, 4], low: [22, 163, 74], info: [59, 130, 246],
          };
          data.cell.styles.textColor = colors[sev] ?? [0, 0, 0];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Key frames
  const kfs = (task.key_frames ?? []) as KeyFrame[];
  if (kfs.length) {
    if (y > 720) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(`Flagged Key Frames (${kfs.length})`, margin, y);
    autoTable(doc, {
      startY: y + 6,
      head: [["@", "Severity", "Label", "Suggested fix"]],
      body: kfs.map((k) => [`${Math.round(k.timestamp_sec)}s`, k.severity, k.label, k.suggested_fix || "—"]),
      headStyles: { fillColor: [40, 40, 50], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8.5, valign: "top" },
      columnStyles: { 0: { cellWidth: 36, halign: "center" }, 1: { cellWidth: 60 } },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Footer page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(140);
    doc.text(`Page ${i} of ${pages}`, pageW - margin, doc.internal.pageSize.getHeight() - 16, { align: "right" });
  }

  doc.save(`qc-${slug(task.page_title)}-${today()}.pdf`);
}

export function exportTaskJson(task: QcTask, issues: QcIssue[]) {
  const payload = { exported_at: new Date().toISOString(), task, issues };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `qc-${slug(task.page_title)}-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

interface DiffPdfArgs {
  campaignName: string;
  fromLabel: string;
  toLabel: string;
  fromScores: { overall: number | null; technical: number | null; brand: number | null; strategic: number | null; contextual: number | null };
  toScores: { overall: number | null; technical: number | null; brand: number | null; strategic: number | null; contextual: number | null };
  diff: IssueDiff;
}

export function exportDiffPdf(args: DiffPdfArgs) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text(`${args.campaignName} — Diff ${args.fromLabel} → ${args.toLabel}`, margin, y); y += 20;
  doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(110);
  doc.text(`Generated ${new Date().toLocaleString()}`, margin, y); doc.setTextColor(0); y += 14;

  const d = (a: number | null, b: number | null) => (a == null || b == null ? "" : ` (${b - a > 0 ? "+" : ""}${b - a})`);
  autoTable(doc, {
    startY: y,
    head: [["", "Overall", "Technical", "Brand", "Strategic", "Contextual"]],
    body: [
      [args.fromLabel, fmtScore(args.fromScores.overall), fmtScore(args.fromScores.technical), fmtScore(args.fromScores.brand), fmtScore(args.fromScores.strategic), fmtScore(args.fromScores.contextual)],
      [args.toLabel, fmtScore(args.toScores.overall) + d(args.fromScores.overall, args.toScores.overall),
        fmtScore(args.toScores.technical) + d(args.fromScores.technical, args.toScores.technical),
        fmtScore(args.toScores.brand) + d(args.fromScores.brand, args.toScores.brand),
        fmtScore(args.toScores.strategic) + d(args.fromScores.strategic, args.toScores.strategic),
        fmtScore(args.toScores.contextual) + d(args.fromScores.contextual, args.toScores.contextual)],
    ],
    headStyles: { fillColor: [30, 30, 35], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 10, halign: "center" },
    columnStyles: { 0: { halign: "left", fontStyle: "bold" } },
    margin: { left: margin, right: margin },
  });
  y = (doc as any).lastAutoTable.finalY + 14;

  const section = (title: string, rows: string[][]) => {
    if (y > 720) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(title, margin, y); y += 4;
    autoTable(doc, {
      startY: y + 4,
      head: [["Sev", "@", "Bucket", "Issue"]],
      body: rows.length ? rows : [["—", "—", "—", "None"]],
      headStyles: { fillColor: [40, 40, 50], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8.5, valign: "top" },
      columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 36, halign: "center" }, 2: { cellWidth: 80 } },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  };

  section(`Fixed (${args.diff.fixed.length})`, args.diff.fixed.map((i) => [
    i.severity.toUpperCase(), i.timestamp_sec != null ? `${Math.round(i.timestamp_sec)}s` : "—", BUCKET_LABEL[i.bucket], i.title,
  ]));
  section(`Regressed (${args.diff.regressed.length})`, args.diff.regressed.map(({ from, to }) => [
    `${from.severity}→${to.severity}`.toUpperCase(), to.timestamp_sec != null ? `${Math.round(to.timestamp_sec)}s` : "—", BUCKET_LABEL[to.bucket], to.title,
  ]));
  section(`New (${args.diff.added.length})`, args.diff.added.map((i) => [
    i.severity.toUpperCase(), i.timestamp_sec != null ? `${Math.round(i.timestamp_sec)}s` : "—", BUCKET_LABEL[i.bucket], i.title,
  ]));

  doc.save(`qc-diff-${slug(args.campaignName)}-${args.fromLabel}-${args.toLabel}-${today()}.pdf`);
}
