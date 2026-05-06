import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, ListPlus, CheckCircle2, XCircle } from "lucide-react";
import { bulkCreate, BulkCreateResult } from "@/lib/qc-client";

export default function BulkUpload() {
  const [text, setText] = useState("");
  const [compliance, setCompliance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BulkCreateResult[]>([]);
  const navigate = useNavigate();

  function parseUrls(): string[] {
    return text.split(/[\n,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
  }
  const urls = parseUrls();

  async function handleFile(f: File) {
    const t = await f.text();
    setText(t);
  }

  async function run() {
    if (!urls.length) return;
    setBusy(true);
    const r = await bulkCreate(urls, compliance);
    setResults(r);
    setBusy(false);
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="surface-card p-6">
          <div className="mb-2 flex items-center gap-2 text-lg font-semibold"><ListPlus className="h-5 w-5 text-primary" /> Bulk QC Upload</div>
          <p className="mb-4 text-sm text-muted-foreground">Paste URLs (one per line or comma-separated), or upload a CSV/TXT. Each URL is scraped, videos detected, and QC tasks queued.</p>

          <Label className="text-xs uppercase tracking-wider text-muted-foreground">URLs</Label>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="https://...&#10;https://..." className="mt-1 font-mono text-xs" />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <input type="file" accept=".csv,.txt" id="bulkfile" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <label htmlFor="bulkfile"><Button variant="outline" size="sm" asChild><span>Upload CSV/TXT</span></Button></label>
              <div className="flex items-center gap-2 text-sm">
                <Switch checked={compliance} onCheckedChange={setCompliance} id="comp" />
                <Label htmlFor="comp" className="text-xs">Compliance check</Label>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{urls.length} valid URLs</span>
              <Button onClick={run} disabled={busy || !urls.length}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Run QC on {urls.length}</Button>
            </div>
          </div>

          {results.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-sm font-medium">Results</div>
              <div className="space-y-1.5 text-xs">
                {results.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md border border-border bg-secondary/20 p-2">
                    {r.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-score-good" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-severity-critical" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{r.url}</div>
                      {r.error && <div className="text-severity-critical">{r.error}</div>}
                      {r.taskIds.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.taskIds.map((id) => (
                            <button key={id} onClick={() => navigate(`/task/${id}`)} className="rounded bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/20">#{id.slice(0, 8)}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
