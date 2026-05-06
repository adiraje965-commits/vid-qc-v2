import { supabase } from "@/integrations/supabase/client";
import { createLocalTaskForVideo } from "@/lib/local-qc";

export interface DetectedVideo {
  url: string;
  type: "youtube" | "vimeo" | "bajaj" | "file" | "other";
  title?: string;
  thumbnail?: string;
}

export interface ScrapeResult {
  pageTitle: string | null;
  pageMarkdown: string;
  videos: DetectedVideo[];
  ogImage: string | null;
}

export interface BulkCreateResult {
  url: string;
  ok: boolean;
  taskIds: string[];
  error?: string;
}

function classify(url: string): DetectedVideo["type"] {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/vimeo\.com/i.test(url)) return "vimeo";
  if (/videos\.bajajfinserv\.in/i.test(url)) return "bajaj";
  if (/\.(mp4|webm|mov|m3u8|mpd)(\?|#|$)/i.test(url)) return "file";
  return "other";
}

function thumbFor(url: string, type: DetectedVideo["type"]): string | undefined {
  if (type === "youtube") {
    const m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
    if (m) return `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
  }
  return undefined;
}

export async function scrapePage(url: string): Promise<ScrapeResult> {
  const { data, error } = await withTimeout(
    supabase.functions.invoke("scrape-page", { body: { url } }),
    8000,
    "Page scan timed out. Using local direct-video fallback.",
  );
  if (error) {
    const fallback = fallbackScrape(url);
    if (fallback.videos.length) return fallback;
    throw new Error(`Page scan failed: ${error.message}. If Lovable shows missing Firecrawl connection, link it or paste a direct video URL.`);
  }
  const urls: string[] = data?.videoUrls ?? (data?.videoUrl ? [data.videoUrl] : []);
  const videos: DetectedVideo[] = urls.map((u, i) => {
    const type = classify(u);
    return { url: u, type, title: `Video ${i + 1}`, thumbnail: thumbFor(u, type) };
  });
  return {
    pageTitle: data?.metadata?.title ?? null,
    pageMarkdown: data?.markdown ?? "",
    ogImage: data?.metadata?.ogImage ?? null,
    videos,
  };
}

function fallbackScrape(url: string): ScrapeResult {
  const type = classify(url);
  const isVideo = type !== "other";
  const video = isVideo ? [{ url, type, title: "Direct video URL", thumbnail: thumbFor(url, type) }] : [];
  return {
    pageTitle: isVideo ? "Direct video analysis" : "Manual scan required",
    pageMarkdown: `Source URL: ${url}`,
    ogImage: null,
    videos: video,
  };
}

export async function createTaskForVideo(
  pageUrl: string,
  video: DetectedVideo,
  context: { pageTitle: string | null; pageMarkdown: string; ogImage: string | null; allVideos: DetectedVideo[] },
  complianceCheck: boolean
): Promise<string> {
  const scrapedContext: ScrapeResult = {
    pageTitle: context.pageTitle,
    pageMarkdown: context.pageMarkdown,
    ogImage: context.ogImage,
    videos: context.allVideos,
  };

  try {
    const { data, error } = await supabase
      .from("qc_tasks")
      .insert({
        url: pageUrl,
        status: "processing",
        video_url: video.url,
        page_title: context.pageTitle,
        page_markdown: context.pageMarkdown,
        thumbnail_url: video.thumbnail ?? context.ogImage,
        detected_videos: context.allVideos as any,
        video_count: context.allVideos.length,
      })
      .select("id")
      .single();
    if (error) throw error;
    const taskId = data.id;
    const { error: invokeError } = await withTimeout(
      supabase.functions.invoke("run-qc", {
        body: {
          taskId,
          url: pageUrl,
          complianceCheck,
          videoUrl: video.url,
          pageMarkdown: context.pageMarkdown,
          pageTitle: context.pageTitle,
          skipScrape: true,
        },
      }),
      18000,
      "QC service timed out. Using local fallback QC.",
    );
    if (invokeError) {
      await supabase.from("qc_tasks").update({
        status: "failed",
        error_message: invokeError.message,
      }).eq("id", taskId);
      throw invokeError;
    }
    return taskId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createLocalTaskForVideo(pageUrl, video, scrapedContext, complianceCheck, message);
  }
}

async function withTimeout<T extends { error?: any }>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((resolve) => {
      window.setTimeout(() => resolve({ error: new Error(message) } as T), timeoutMs);
    }),
  ]);
}

// Legacy helpers (kept for bulk flow): scrape + auto-pick first video
export async function createTaskAndAnalyze(url: string, complianceCheck: boolean): Promise<string> {
  const scraped = await scrapePage(url);
  const video = scraped.videos[0] ?? { url: "", type: "other" as const };
  return createTaskForVideo(url, video, { ...scraped, allVideos: scraped.videos }, complianceCheck);
}

export async function bulkCreate(urls: string[], complianceCheck: boolean): Promise<BulkCreateResult[]> {
  const results: BulkCreateResult[] = [];
  for (const url of urls) {
    try {
      const id = await createTaskAndAnalyze(url, complianceCheck);
      results.push({ url, ok: true, taskIds: [id] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(e);
      results.push({ url, ok: false, taskIds: [], error: message });
    }
  }
  return results;
}
