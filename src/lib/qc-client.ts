import { supabase } from "@/integrations/supabase/client";

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
  const { data, error } = await supabase.functions.invoke("scrape-page", { body: { url } });
  if (error) throw error;
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

export async function createTaskForVideo(
  pageUrl: string,
  video: DetectedVideo,
  context: { pageTitle: string | null; pageMarkdown: string; ogImage: string | null; allVideos: DetectedVideo[] },
  complianceCheck: boolean
): Promise<string> {
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
  supabase.functions
    .invoke("run-qc", {
      body: {
        taskId,
        url: pageUrl,
        complianceCheck,
        videoUrl: video.url,
        pageMarkdown: context.pageMarkdown,
        pageTitle: context.pageTitle,
        skipScrape: true,
      },
    })
    .catch((e) => console.error("run-qc invoke error", e));
  return taskId;
}

// Legacy helpers (kept for bulk flow): scrape + auto-pick first video
export async function createTaskAndAnalyze(url: string, complianceCheck: boolean): Promise<string> {
  const scraped = await scrapePage(url);
  const video = scraped.videos[0] ?? { url: "", type: "other" as const };
  return createTaskForVideo(url, video, { ...scraped, allVideos: scraped.videos }, complianceCheck);
}

export async function bulkCreate(urls: string[], complianceCheck: boolean) {
  const ids: string[] = [];
  for (const url of urls) {
    try { ids.push(await createTaskAndAnalyze(url, complianceCheck)); } catch (e) { console.error(e); }
  }
  return ids;
}
