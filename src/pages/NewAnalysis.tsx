import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bulkCreate, createTaskAndAnalyze } from "@/lib/qc-client";
import { toast } from "sonner";
import { CheckCircle2, FileText, Link2, Loader2, Upload } from "lucide-react";

export default function NewAnalysis() {
  const nav = useNavigate();
  const [url, setUrl] = useState("");
  const [bulk, setBulk] = useState("");
  const [compliance, setCompliance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<string[]>([]);

  const handleSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      const id = await createTaskAndAnalyze(url.trim(), compliance);
      toast.success("Analysis started");
      nav(`/task/${id}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to start");
    } finally { setBusy(false); }
  };

  const parseUrls = (raw: string) =>
    raw.split(/[\n,\r]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));

  const handleBulk = async () => {
    const urls = parseUrls(bulk);
    if (!urls.length) { toast.error("No valid URLs detected"); return; }
    setBusy(true);
    try {
      const ids = await bulkCreate(urls, compliance);
      setQueued(ids);
      toast.success(`Queued ${ids.length} videos`);
    } finally { setBusy(false); }
  };

  const handleCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const text = await f.text();
    setBulk(text);
  };

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">New Analysis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Provide a page URL — Firecrawl scrapes the context, then our AI scores the embedded video.
        </p>

        <div className="surface-card mt-6 p-6">
          <Tabs defaultValue="single">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="single" className="gap-2"><Link2 className="h-4 w-4" /> Single URL</TabsTrigger>
              <TabsTrigger value="bulk" className="gap-2"><Upload className="h-4 w-4" /> Bulk Upload</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="pt-6">
              <form onSubmit={handleSingle} className="space-y-4">
                <div>
                  <Label htmlFor="url">Landing Page URL</Label>
                  <Input id="url" type="url" placeholder="https://www.bajajfinserv.in/personal-loan" value={url} onChange={(e) => setUrl(e.target.value)} className="mt-2 h-11" required />
                  <p className="mt-1.5 text-xs text-muted-foreground">We'll scrape the page and locate the embedded video.</p>
                </div>
                <ComplianceToggle value={compliance} onChange={setCompliance} />
                <Button type="submit" size="lg" disabled={busy} className="w-full gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Run QC Analysis
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="bulk" className="space-y-4 pt-6">
              <div>
                <Label htmlFor="bulk">URLs (one per line) or paste CSV</Label>
                <Textarea id="bulk" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"https://example.com/page1\nhttps://example.com/page2"} rows={8} className="mt-2 font-mono text-xs" />
              </div>
              <div className="flex items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm hover:bg-secondary/70">
                  <FileText className="h-4 w-4" /> Upload CSV
                  <input type="file" accept=".csv,.txt" className="hidden" onChange={handleCsv} />
                </label>
                <span className="text-xs text-muted-foreground">{parseUrls(bulk).length} valid URL(s) detected</span>
              </div>
              <ComplianceToggle value={compliance} onChange={setCompliance} />
              <Button onClick={handleBulk} size="lg" disabled={busy} className="w-full gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Queue Bulk Analysis
              </Button>
              {queued.length > 0 && (
                <div className="rounded-md border border-border bg-secondary/50 p-3 text-sm">
                  Queued {queued.length} task(s).{" "}
                  <a className="text-primary underline" onClick={() => nav("/")}>Go to Dashboard</a>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

function ComplianceToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-secondary/40 p-4">
      <div>
        <div className="text-sm font-medium">Compliance Check</div>
        <div className="text-xs text-muted-foreground">Verify mandatory legal disclaimers (T&C apply, RBI compliance) appear at the end.</div>
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}
