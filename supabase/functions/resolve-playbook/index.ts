// resolve-playbook: takes a Playbook (or any) share URL → resolves a direct
// MP4/HLS URL we can hand to deep-video-review.
//
// Strategy:
// 0) Playbook fast path — call Playbook's GraphQL directly using
//    org-slug + shared-link-slug headers (no auth needed for public shares).
//    - With ?assetToken=… → FullAssetModalQuery → asset.url
//    - Without assetToken → scrape page once for data-collection-token,
//      then CollectionAssetsQuery → list of assets. If exactly one video,
//      return it; otherwise return needsAssetSelection.
// 1) If URL already looks like a media file, accept it.
// 2) Direct fetch + extract from HTML (og:video, <video>/<source>, JSON blobs).
// 3) Firecrawl rendered scrape fallback.
// Always returns JSON; never throws to the client.

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";
const MEDIA_EXT_RE = /\.(mp4|m4v|mov|webm|m3u8)(\?|#|$)/i;
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// ---------- Playbook GraphQL ----------

const PB_FULL_ASSET_OP_ID = "graphql-frontend-prod/e88447f0bab7b7d6bfd2364dd2253858";
const PB_COLLECTION_ASSETS_OP_ID = "graphql-frontend-prod/02aafb123aa4f9ad468834c746542cb1";

type PlaybookCtx = { org: string; sharedLinkSlug: string; assetToken: string | null; raw: URL };

const PB_RESERVED_SEGMENTS = new Set([
  "s", "api", "graphql", "assets", "static", "auth", "login", "logout",
  "signup", "signin", "_next", "favicon.ico", "settings", "pricing",
  "about", "help", "privacy", "terms", "contact", "blog", "download",
  "discover", "explore",
]);

function parsePlaybookUrl(input: string): PlaybookCtx | null {
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  if (!/(^|\.)playbook\.com$/i.test(u.hostname)) return null;
  // /s/<org>/<sharedLinkSlug> (canonical share link)
  let m = u.pathname.match(/^\/s\/([^\/]+)\/([^\/?#]+)/);
  if (!m) {
    // Bare /<org>/<sharedLinkSlug> form (also valid)
    const bare = u.pathname.match(/^\/([^\/]+)\/([^\/?#]+)/);
    if (bare && !PB_RESERVED_SEGMENTS.has(bare[1].toLowerCase())) {
      m = bare;
    }
  }
  if (!m) return null;
  return {
    org: m[1],
    sharedLinkSlug: m[2],
    assetToken: u.searchParams.get("assetToken"),
    raw: u,
  };
}

async function pbGraphQL(ctx: PlaybookCtx, operationName: string, operationId: string, variables: Record<string, unknown>) {
  const url = new URL("https://www.playbook.com/graphql");
  url.searchParams.set("operationName", operationName);
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set("extensions", JSON.stringify({ operationId }));
  const res = await fetch(url.toString(), {
    headers: {
      organization: ctx.org,
      sharedlinkslug: ctx.sharedLinkSlug,
      clienttype: "web-app",
      accept: "*/*",
      "User-Agent": BROWSER_HEADERS["User-Agent"],
    },
  });
  if (!res.ok) throw new Error(`Playbook GraphQL ${operationName} ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Playbook GraphQL: ${json.errors[0]?.message ?? "error"}`);
  return json.data;
}

function pbAssetSummary(a: any) {
  const thumb = a?.safeThumbnail?.url
    ?? (Array.isArray(a?.thumbnails) ? a.thumbnails[0]?.url : null)
    ?? null;
  return {
    token: a?.token as string,
    title: (a?.title as string) ?? null,
    duration: typeof a?.duration === "number" ? a.duration : null,
    mediaType: (a?.mediaType as string) ?? null,
    thumbnail: thumb as string | null,
    url: (a?.url as string) ?? null,
  };
}

async function pbResolveCollectionToken(ctx: PlaybookCtx): Promise<string | null> {
  // The shared page exposes data-collection-token in HTML (no auth needed).
  const res = await fetch(`https://www.playbook.com/s/${ctx.org}/${ctx.sharedLinkSlug}`, {
    headers: BROWSER_HEADERS,
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/data-collection-token=["']([^"']+)["']/);
  return m ? m[1] : null;
}

async function resolveViaPlaybook(ctx: PlaybookCtx) {
  // Single-asset deep link
  if (ctx.assetToken) {
    const data = await pbGraphQL(ctx, "FullAssetModalQuery", PB_FULL_ASSET_OP_ID, { assetToken: ctx.assetToken });
    const a = data?.asset;
    if (!a?.url) {
      return { ok: false, error: "Playbook asset has no downloadable URL (may be private or still processing)." };
    }
    if (typeof a.mediaType === "string" && !a.mediaType.startsWith("video/")) {
      return { ok: false, error: `Asset is not a video (mediaType=${a.mediaType}).` };
    }
    const s = pbAssetSummary(a);
    return { ok: true, directVideoUrl: s.url, thumbnailUrl: s.thumbnail, title: s.title, via: "playbook-graphql" };
  }

  // Board / collection link — defer listing to list-playbook-assets (paginated).
  return {
    ok: false,
    needsAssetSelection: true,
    board: { org: ctx.org, sharedLinkSlug: ctx.sharedLinkSlug },
    error: "This Playbook board has multiple videos. Pick one to continue.",
  };
}

// ---------- Generic fallback (unchanged) ----------

function decode(raw: string) {
  return raw.replace(/\\u0026/gi, "&").replace(/&amp;/gi, "&").replace(/\\\//g, "/");
}
function abs(base: string, ref: string) { try { return new URL(decode(ref), base).toString(); } catch { return decode(ref); } }

function collect(value: unknown, out: string[]) {
  if (!value) return;
  if (typeof value === "string") {
    const v = decode(value);
    if (/^https?:\/\//i.test(v) && MEDIA_EXT_RE.test(v)) out.push(v);
    return;
  }
  if (Array.isArray(value)) for (const v of value) collect(v, out);
  else if (typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) collect(v, out);
}

function pickBest(cands: string[]): string | null {
  const mp4 = cands.find((u) => /\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(u));
  if (mp4) return mp4;
  return cands.find((u) => /\.m3u8(\?|#|$)/i.test(u)) ?? null;
}

function extractFromHtml(html: string, baseUrl: string): { url: string | null; thumb: string | null; title: string | null } {
  const c: string[] = [];
  for (const m of html.matchAll(/<meta[^>]+property=["']og:(?:video|audio)(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/gi)) c.push(abs(baseUrl, m[1]));
  for (const m of html.matchAll(/<(?:source|video|audio)[^>]+src=["']([^"']+)["']/gi)) c.push(abs(baseUrl, m[1]));
  for (const m of html.matchAll(/\sdata-(?:src|hls|mp4|video-url|stream|playback-url|manifest)=["']([^"']+)["']/gi)) c.push(abs(baseUrl, m[1]));
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const s = m[1]; if (!s || s.length > 500_000) continue;
    const t = s.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try { const j = JSON.parse(t); const cc: string[] = []; collect(j, cc); for (const x of cc) c.push(abs(baseUrl, x)); } catch {}
    }
  }
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\]+\.(?:mp4|m4v|mov|webm|m3u8)(?:\?[^\s"'<>\\]*)?/gi)) c.push(m[0]);
  for (const m of html.matchAll(/https?:\\?\/\\?\/[^"'\s<>)]+\.(?:mp4|m4v|mov|webm|m3u8)(?:\?[^"'\s<>)]*)?/gi)) c.push(decode(m[0]));

  const url = pickBest(c.filter((u) => /^https?:\/\//i.test(u)));
  const thumbMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return {
    url,
    thumb: thumbMatch ? abs(baseUrl, thumbMatch[1]) : null,
    title: titleMatch ? titleMatch[1].trim() : null,
  };
}

async function fetchDirect(url: string): Promise<{ html: string; finalUrl: string; status: number; ct: string }> {
  const r = await fetch(url, { headers: { ...BROWSER_HEADERS, Referer: new URL(url).origin + "/" }, redirect: "follow" });
  const ct = r.headers.get("content-type") ?? "";
  if (ct.startsWith("video/") || ct.startsWith("audio/")) { await r.body?.cancel(); return { html: "", finalUrl: r.url, status: r.status, ct }; }
  const html = await r.text();
  return { html, finalUrl: r.url, status: r.status, ct };
}

async function fetchViaFirecrawl(url: string): Promise<{ html: string; finalUrl: string; links: string[] } | null> {
  if (!FIRECRAWL_API_KEY) return null;
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["rawHtml", "links"], onlyMainContent: false, waitFor: 3000 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const p = data?.data ?? data ?? {};
    return {
      html: p.rawHtml || p.html || "",
      finalUrl: p.metadata?.sourceURL || url,
      links: Array.isArray(p.links) ? p.links : [],
    };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return new Response(JSON.stringify({ ok: false, error: "Provide a valid http(s) URL." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 0) Playbook fast path
    const pb = parsePlaybookUrl(url);
    if (pb) {
      try {
        const out = await resolveViaPlaybook(pb);
        return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        console.warn("[resolve-playbook] playbook path failed", e instanceof Error ? e.message : String(e));
        // Fall through to generic ladder.
      }
    }

    // 1) Already a media URL?
    if (MEDIA_EXT_RE.test(url)) {
      return new Response(JSON.stringify({ ok: true, directVideoUrl: url, thumbnailUrl: null, title: null, via: "direct-ext" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Direct fetch
    let html = ""; let finalUrl = url;
    try {
      const r = await fetchDirect(url);
      if (r.ct.startsWith("video/")) {
        return new Response(JSON.stringify({ ok: true, directVideoUrl: r.finalUrl, thumbnailUrl: null, title: null, via: "direct-ct" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      html = r.html; finalUrl = r.finalUrl;
    } catch (e) {
      console.warn("[resolve-playbook] direct failed", e instanceof Error ? e.message : String(e));
    }

    let { url: media, thumb, title } = html ? extractFromHtml(html, finalUrl) : { url: null, thumb: null, title: null };

    // 3) Firecrawl fallback
    if (!media) {
      const fc = await fetchViaFirecrawl(url);
      if (fc) {
        finalUrl = fc.finalUrl;
        const r2 = extractFromHtml(fc.html, fc.finalUrl);
        media = r2.url ?? pickBest(fc.links.filter((u) => MEDIA_EXT_RE.test(u)));
        thumb = thumb ?? r2.thumb;
        title = title ?? r2.title;
      }
    }

    if (!media) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Could not extract a direct video URL from the share link. The page may require login, use a custom player, or hide the asset behind signed JS. You can paste the direct .mp4 URL instead.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, directVideoUrl: media, thumbnailUrl: thumb, title, via: "extracted" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
