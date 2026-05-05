import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { bulkCreate, createTaskForVideo, scrapePage, DetectedVideo, ScrapeResult } from "@/lib/qc-client";
import { toast } from "sonner";
import { CheckCircle2, FileText, Link2, Loader2, Play, Search, Upload, Video } from "lucide-react";

export default function NewAnalysis() {
  const nav = useNavigate();
  const [url, setUrl] = useState("");
  const [bulk, setBulk] = useState("");
  const [compliance, setCompliance] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scraped, setScraped] = useState<ScrapeResult | null>(null);
  const [queued, setQueued] = useState<string[]>([]);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setScanning(true);
    setScraped(null);
    try {
      const r = await scrapePage(url.trim());
      setScraped(r);
      if (!r.videos.length) toast.warning("No videos detected on this page");
      else toast.success(`Found ${r.videos.length} video${r.videos.length > 1 ? "s" : ""}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to scan page");
    } finally { setScanning(false); }
  };

  const runQc = async (video: DetectedVideo) => {
    if (!scraped) {
      toast.error("Please scan the page first");
      return;
    }
    setBusy(true);
    try {
      console.log("[NewAnalysis] creating task for video", video.url);
      const id = await createTaskForVideo(url.trim(), video, { ...scraped, allVideos: scraped.videos }, compliance);
      console.log("[NewAnalysis] task created", id, "navigating…");
      toast.success("Analysis started");
      nav(`/task/${id}`);
    } catch (err: any) {
      console.error("[NewAnalysis] runQc error", err);
      toast.error(err?.message ?? "Failed to start analysis");
      setBusy(false);
    }
  };

  const runAll = async () => {
    if (!scraped) return;
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const v of scraped.videos) {
        const id = await createTaskForVideo(url.trim(), v, { ...scraped, allVideos: scraped.videos }, compliance);
        ids.push(id);
      }
      toast.success(`Queued ${ids.length} analyses`);
      nav("/");
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
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">New Analysis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan a page, review every video found, then run QC on the ones that matter.
        </p>

        <div className="surface-card mt-6 p-6">
          <Tabs defaultValue="single">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="single" className="gap-2"><Link2 className="h-4 w-4" /> Single URL</TabsTrigger>
              <TabsTrigger value="bulk" className="gap-2"><Upload className="h-4 w-4" /> Bulk Upload</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="pt-6">
              <form onSubmit={handleScan} className="space-y-4">
                <div>
                  <Label htmlFor="url">Landing Page URL</Label>
                  <Input id="url" type="url" placeholder="https://www.bajajfinserv.in/personal-loan" value={url} onChange={(e) => { setUrl(e.target.value); setScraped(null); }} className="mt-2 h-11" required />
                </div>
                <ComplianceToggle value={compliance} onChange={setCompliance} />
                <Button type="submit" size="lg" disabled={scanning} className="w-full gap-2">
                  {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {scanning ? "Scanning page…" : "Scan Page for Videos"}
                </Button>
              </form>

              {scraped && (
                <div className="mt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{scraped.pageTitle ?? "Page"}</div>
                      <div className="text-xs text-muted-foreground">
                        {scraped.videos.length} video{scraped.videos.length === 1 ? "" : "s"} detected
                      </div>
                    </div>
                    {scraped.videos.length > 1 && (
                      <Button onClick={runAll} disabled={busy} variant="secondary" size="sm" className="gap-2">
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Run QC on All
                      </Button>
                    )}
                  </div>

                  {scraped.videos.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border bg-secondary/30 p-6 text-center text-sm text-muted-foreground">
                      No embedded videos found. Try another page.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {scraped.videos.map((v, i) => (
                        <li key={v.url} className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3">
                          <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/60">
                            {v.thumbnail ? (
                              <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <Video className="h-6 w-6 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">Video {i + 1}</span>
                              <Badge variant="outline" className="text-[10px] uppercase">{v.type}</Badge>
                            </div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">{v.url}</div>
                          </div>
                          <Button onClick={() => runQc(v)} disabled={busy} size="sm" className="gap-1.5 shrink-0">
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                            Run Video QC
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
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
                  <a className="text-primary underline cursor-pointer" onClick={() => nav("/")}>Go to Dashboard</a>
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
