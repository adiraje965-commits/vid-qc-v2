import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BulkCreateResult, DetectedVideo, ScrapeResult, bulkCreate, createTaskForVideo, scrapePage } from "@/lib/qc-client";
import { AlertTriangle, CheckCircle2, FileText, Link2, Loader2, Play, Search, Upload, Video, Wand2 } from "lucide-react";
import { toast } from "sonner";

const SCRAPE_CACHE_KEY = "qc:lastScrape";

export default function NewAnalysis() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [url, setUrl] = useState("");
  const [bulk, setBulk] = useState("");
  const [compliance, setCompliance] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scraped, setScraped] = useState<ScrapeResult | null>(null);
  const [queued, setQueued] = useState<BulkCreateResult[]>([]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SCRAPE_CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as { url: string; result: ScrapeResult };
      const wantUrl = params.get("url") ?? cached.url;
      if (wantUrl && cached.url === wantUrl) {
        setUrl(cached.url);
        setScraped(cached.result);
      }
    } catch {
      // Session cache is best-effort only.
    }
  }, [params]);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setScanning(true);
    setScraped(null);
    try {
      const result = await scrapePage(url.trim());
      setScraped(result);
      try {
        sessionStorage.setItem(SCRAPE_CACHE_KEY, JSON.stringify({ url: url.trim(), result }));
      } catch {
        // Ignore storage quota/private-mode failures.
      }
      if (!result.videos.length) {
        toast.warning("No videos detected. Link Firecrawl in Lovable or paste a direct video URL.");
      } else {
        toast.success(`Found ${result.videos.length} video${result.videos.length > 1 ? "s" : ""}`);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to scan page");
    } finally {
      setScanning(false);
    }
  };

  const runQc = async (video: DetectedVideo) => {
    if (!scraped) {
      toast.error("Please scan the page first");
      return;
    }
    setBusy(true);
    try {
      const id = await createTaskForVideo(url.trim(), video, { ...scraped, allVideos: scraped.videos }, compliance);
      toast.success(id.startsWith("local_") ? "Local fallback QC completed" : "Analysis completed");
      nav(`/task/${id}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to start analysis");
      setBusy(false);
    }
  };

  const runAll = async () => {
    if (!scraped) return;
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const video of scraped.videos) {
        const id = await createTaskForVideo(url.trim(), video, { ...scraped, allVideos: scraped.videos }, compliance);
        ids.push(id);
      }
      const localCount = ids.filter((id) => id.startsWith("local_")).length;
      toast.success(`Finished ${ids.length} analyses${localCount ? ` (${localCount} local fallback)` : ""}`);
      nav("/");
    } catch (err: any) {
      toast.error(err?.message ?? "Run all failed");
    } finally {
      setBusy(false);
    }
  };

  const handleBulk = async () => {
    const urls = parseUrlInput(bulk);
    if (!urls.length) {
      toast.error("No valid URLs detected");
      return;
    }
    setBusy(true);
    try {
      const results = await bulkCreate(urls, compliance);
      setQueued(results);
      const success = results.filter((result) => result.ok).length;
      const failed = results.length - success;
      if (success) toast.success(`Finished ${success} URL${success === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`);
      if (failed && !success) toast.error("Bulk analysis failed for every URL");
    } finally {
      setBusy(false);
    }
  };

  const handleCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulk(await file.text());
  };

  const validBulkCount = parseUrlInput(bulk).length;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs text-primary">
              <Wand2 className="h-3.5 w-3.5" /> Smart fallback enabled
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">New Analysis</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Scan a page, review every video found, then run QC on selected videos or a full CSV batch.
            </p>
          </div>
        </div>

        <div className="surface-card mt-6 p-6">
          <Tabs defaultValue="single">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="single" className="gap-2"><Link2 className="h-4 w-4" /> Single URL</TabsTrigger>
              <TabsTrigger value="bulk" className="gap-2"><Upload className="h-4 w-4" /> Bulk CSV</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="pt-6">
              <form onSubmit={handleScan} className="space-y-4">
                <div>
                  <Label htmlFor="url">Landing Page or Direct Video URL</Label>
                  <Input
                    id="url"
                    type="url"
                    placeholder="https://www.bajajfinserv.in/personal-loan"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setScraped(null);
                    }}
                    className="mt-2 h-11"
                    required
                  />
                </div>
                <ComplianceToggle value={compliance} onChange={setCompliance} />
                <Button type="submit" size="lg" disabled={scanning} className="w-full gap-2">
                  {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {scanning ? "Scanning page..." : "Scan Page for Videos"}
                </Button>
              </form>

              {scraped && (
                <div className="mt-6 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{scraped.pageTitle ?? "Page"}</div>
                      <div className="text-xs text-muted-foreground">
                        {scraped.videos.length} video{scraped.videos.length === 1 ? "" : "s"} detected
                      </div>
                    </div>
                    <Button onClick={runAll} disabled={busy || !scraped.videos.length} variant="secondary" size="sm" className="gap-2">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Run QC on All
                    </Button>
                  </div>

                  {scraped.videos.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border bg-secondary/30 p-6 text-center text-sm text-muted-foreground">
                      <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-severity-medium" />
                      No embedded videos found. If Lovable still shows Firecrawl missing, link that connection or paste a direct .mp4, YouTube, Vimeo, or Bajaj video URL.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {scraped.videos.map((video, index) => (
                        <li key={`${video.url}-${index}`} className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3 transition hover:border-primary/40 hover:bg-secondary/50">
                          <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/60">
                            {video.thumbnail ? (
                              <img src={video.thumbnail} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <Video className="h-6 w-6 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">Video {index + 1}</span>
                              <Badge variant="outline" className="text-[10px] uppercase">{video.type}</Badge>
                            </div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">{video.url}</div>
                          </div>
                          <Button onClick={() => runQc(video)} disabled={busy} size="sm" className="shrink-0 gap-1.5">
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
                <Label htmlFor="bulk">URLs, CSV, or one URL per line</Label>
                <Textarea
                  id="bulk"
                  value={bulk}
                  onChange={(e) => setBulk(e.target.value)}
                  placeholder={"url,title\nhttps://example.com/page1,Personal loan video\nhttps://example.com/page2,EMI card video"}
                  rows={9}
                  className="mt-2 font-mono text-xs"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm hover:bg-secondary/70">
                  <FileText className="h-4 w-4" /> Upload CSV
                  <input type="file" accept=".csv,.txt" className="hidden" onChange={handleCsv} />
                </label>
                <span className="text-xs text-muted-foreground">{validBulkCount} valid URL(s) detected from lines, commas, or CSV cells</span>
              </div>
              <ComplianceToggle value={compliance} onChange={setCompliance} />
              <Button onClick={handleBulk} size="lg" disabled={busy || !validBulkCount} className="w-full gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Run Bulk QC
              </Button>
              {queued.length > 0 && (
                <div className="rounded-md border border-border bg-secondary/50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span>Finished {queued.filter((result) => result.ok).length} of {queued.length} URL(s).</span>
                    <a className="cursor-pointer text-primary underline" onClick={() => nav("/")}>Go to Dashboard</a>
                  </div>
                  <ul className="mt-3 max-h-48 space-y-1 overflow-auto text-xs">
                    {queued.map((result) => (
                      <li key={result.url} className="flex gap-2">
                        <span className={result.ok ? "text-score-good" : "text-severity-critical"}>{result.ok ? "OK" : "FAIL"}</span>
                        <span className="min-w-0 flex-1 truncate">{result.url}</span>
                        {result.error && <span className="max-w-64 truncate text-muted-foreground">{result.error}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

function ComplianceToggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-secondary/40 p-4">
      <div>
        <div className="text-sm font-medium">Compliance Check</div>
        <div className="text-xs text-muted-foreground">Verify required legal disclaimers, conditions copy, and RBI-sensitive wording.</div>
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function parseUrlInput(raw: string) {
  const urls = new Set<string>();
  const cells = raw.match(/"([^"]|"")*"|[^,\n\r\t;]+/g) ?? [];
  for (const cell of cells) {
    const clean = cell.replace(/^"|"$/g, "").replace(/""/g, "\"").trim();
    const match = clean.match(/https?:\/\/[^\s,"'<>]+/i);
    if (match) urls.add(match[0]);
  }
  return Array.from(urls);
}
