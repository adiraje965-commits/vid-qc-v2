import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "url required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY missing");

    // Render JS and wait for dynamic carousels (e.g. Bajaj Finserv video carousels)
    // to initialize before extracting content.
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html", "rawHtml", "links"],
        onlyMainContent: false,
        waitFor: 8000,
        timeout: 60000,
        blockAds: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${JSON.stringify(data)}`);

    const payload = data.data ?? data;
    const markdown: string = payload.markdown ?? "";
    const html: string = payload.html ?? payload.rawHtml ?? "";
    const metadata = payload.metadata ?? {};
    const links: string[] = payload.links ?? [];

    // Collect candidate video URLs from multiple sources.
    const found = new Set<string>();

    const addIfVideo = (u: string | null | undefined) => {
      if (!u) return;
      const clean = u.trim().replace(/^["']|["']$/g, "");
      if (!clean) return;
      // Direct video files
      if (/\.(mp4|webm|mov|m3u8|mpd)(\?|#|$)/i.test(clean)) found.add(clean);
      // Common video hosts / embeds
      if (/(youtube\.com\/(watch|embed|shorts)|youtu\.be\/|vimeo\.com\/|player\.vimeo\.com|jwplayer|brightcove|kaltura|dailymotion\.com|wistia\.com|cdn\.jwplayer|videos\.bajajfinserv\.in)/i.test(clean)) {
        found.add(clean);
      }
    };

    // Decode common HTML entities so attributes inside JSON blobs (&#34; etc.) match.
    const decodeEntities = (s: string) =>
      s.replace(/&#34;/g, '"').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

    // 1. Links array from Firecrawl
    for (const l of links) addIfVideo(l);

    // 2. Markdown URLs
    const mdUrls = markdown.match(/https?:\/\/[^\s)\]]+/gi) ?? [];
    for (const u of mdUrls) addIfVideo(u);

    // 3. HTML scan: <video>, <source>, <iframe>, data-* attributes (carousels often lazy-load)
    if (html) {
      const decoded = decodeEntities(html);

      const attrRe = /(?:src|data-src|data-video|data-video-url|data-mp4|data-hls|data-poster-video|href)\s*=\s*["']([^"']+)["']/gi;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(decoded)) !== null) {
        try {
          const u = new URL(m[1], url).toString();
          addIfVideo(u);
        } catch {
          addIfVideo(m[1]);
        }
      }
      // JSON blobs / inline scripts referencing video URLs
      const jsonUrlRe = /https?:\\?\/\\?\/[^"'\s<>)]+\.(?:mp4|webm|mov|m3u8|mpd)(?:\?[^"'\s<>)]*)?/gi;
      const jsonMatches = decoded.match(jsonUrlRe) ?? [];
      for (const u of jsonMatches) addIfVideo(u.replace(/\\\//g, "/"));

      // Bajaj Finserv "kapsule" player: <... data-video-host="videos.bajajfinserv.in" data-video-id="gcc-...">
      // Also matches kpointId / videoId fields inside JSON blobs.
      const bajajIdRe = /(?:data-video-id|kpointId|videoId)["'\s:=]+["']?(gcc-[a-f0-9-]{8,})/gi;
      let b: RegExpExecArray | null;
      const seenIds = new Set<string>();
      while ((b = bajajIdRe.exec(decoded)) !== null) {
        const id = b[1];
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        found.add(`https://videos.bajajfinserv.in/kapsule/${id}/nv3/embedded`);
      }

      // Generic YouTube ID extraction (data-video-id="abc123" with youtube host)
      const ytIdRe = /data-video-id=["']([A-Za-z0-9_-]{11})["'][^>]*data-video-host=["'][^"']*youtube/gi;
      let y: RegExpExecArray | null;
      while ((y = ytIdRe.exec(decoded)) !== null) {
        found.add(`https://www.youtube.com/watch?v=${y[1]}`);
      }
    }

    const videoUrls = Array.from(found);
    const videoUrl = videoUrls[0] ?? null;

    return new Response(JSON.stringify({
      markdown,
      metadata,
      videoUrl,
      videoUrls,
      links: links.slice(0, 100),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scrape-page error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
