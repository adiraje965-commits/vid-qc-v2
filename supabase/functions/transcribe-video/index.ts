import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

interface Word { text: string; start: number; end: number; speaker_id?: string; type?: string }
interface Segment { start: number; end: number; text: string; speaker?: string }

class ElevenLabsConfigurationError extends Error {
  constructor(message = "ElevenLabs API key is invalid or missing speech-to-text access.") {
    super(message);
    this.name = "ElevenLabsConfigurationError";
  }
}

type ResolvedMedia =
  | { kind: "mp4"; url: string }
  | { kind: "hls"; url: string }
  | { kind: "none"; reason: string };

const MEDIA_EXT_RE = /\.(mp4|m4a|m4v|mp3|webm|wav|ogg|mov|m3u8)(\?|#|$)/i;
const BOT_GATE_MARKERS = /access denied|reference #|just a moment|attention required|cf-browser-verification|cf-chl-bypass|cloudflare|akamai|forbidden/i;

function logResolve(...args: unknown[]) {
  console.log("[resolve]", ...args);
}

function isKnownUnsupported(url: string | null): boolean {
  if (!url) return true;
  if (/vimeo\.com/i.test(url)) return true;
  return false;
}

function classifyByExt(url: string): "mp4" | "hls" | null {
  if (/\.(mp4|m4a|m4v|mp3|webm|wav|ogg|mov)(\?|#|$)/i.test(url)) return "mp4";
  if (/\.m3u8(\?|#|$)/i.test(url)) return "hls";
  return null;
}

function classifyByContentType(ct: string): "mp4" | "hls" | null {
  const t = ct.toLowerCase();
  if (t.includes("mpegurl") || t.includes("vnd.apple.mpegurl")) return "hls";
  if (t.startsWith("audio/") || t.startsWith("video/")) return "mp4";
  if (t === "application/octet-stream") return "mp4";
  return null;
}

function absolutize(base: string, ref: string): string {
  try { return new URL(ref, base).toString(); } catch { return ref; }
}

function pageOrigin(url: string): string {
  try { return new URL(url).origin + "/"; } catch { return url; }
}

// Recursively walk a parsed JSON value collecting any string that looks like a media URL.
function collectMediaFromJson(value: unknown, out: string[]) {
  if (!value) return;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && MEDIA_EXT_RE.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectMediaFromJson(v, out);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectMediaFromJson(v, out);
  }
}

function pickBest(candidates: string[]): { kind: "mp4" | "hls"; url: string } | null {
  // Prefer mp4 (cheaper STT path) over hls.
  const mp4 = candidates.find((u) => classifyByExt(u) === "mp4");
  if (mp4) return { kind: "mp4", url: mp4 };
  const hls = candidates.find((u) => classifyByExt(u) === "hls");
  if (hls) return { kind: "hls", url: hls };
  return null;
}

function findMediaInHtml(html: string, baseUrl: string): { kind: "mp4" | "hls"; url: string } | null {
  const candidates: string[] = [];

  // og:video / og:audio meta
  for (const m of html.matchAll(/<meta[^>]+property=["']og:(?:video|audio)(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/gi)) {
    candidates.push(absolutize(baseUrl, m[1]));
  }
  // <video src> or <source src>
  for (const m of html.matchAll(/<(?:source|video|audio)[^>]+src=["']([^"']+)["']/gi)) {
    candidates.push(absolutize(baseUrl, m[1]));
  }
  // data-* attributes
  for (const m of html.matchAll(/\sdata-(?:src|hls|mp4|video-url|stream|playback-url|manifest)=["']([^"']+)["']/gi)) {
    candidates.push(absolutize(baseUrl, m[1]));
  }
  // JSON-LD VideoObject contentUrl
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      const collected: string[] = [];
      collectMediaFromJson(j, collected);
      for (const c of collected) candidates.push(absolutize(baseUrl, c));
    } catch { /* ignore */ }
  }
  // Generic <script> JSON blobs (Next.js, Redux, Apollo, inline state)
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const s = m[1];
    if (!s || s.length > 500_000) continue;
    // Try direct JSON.parse for pure JSON blobs (e.g. __NEXT_DATA__).
    const trimmed = s.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const j = JSON.parse(trimmed);
        const collected: string[] = [];
        collectMediaFromJson(j, collected);
        for (const c of collected) candidates.push(absolutize(baseUrl, c));
      } catch { /* fall through */ }
    }
    // Pull JSON-ish object literals after `= {` and `JSON.parse("...")`.
    for (const inner of s.matchAll(/JSON\.parse\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*\)/g)) {
      try {
        const decoded = inner[2].replace(/\\(["'\\nrtbf/])/g, (_m, c) => {
          const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
          return map[c] ?? c;
        });
        const j = JSON.parse(decoded);
        const collected: string[] = [];
        collectMediaFromJson(j, collected);
        for (const c of collected) candidates.push(absolutize(baseUrl, c));
      } catch { /* ignore */ }
    }
  }
  // Generic regex over the whole document
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\]+\.(?:mp4|m4a|m4v|mp3|webm|wav|ogg|mov)(?:\?[^\s"'<>\\]*)?/gi)) {
    candidates.push(m[0]);
  }
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/gi)) {
    candidates.push(m[0]);
  }

  // Base64-encoded URL pass: long base64 strings sometimes hide playback URLs.
  for (const m of html.matchAll(/["']([A-Za-z0-9+/=]{60,})["']/g)) {
    try {
      const decoded = atob(m[1]);
      if (/^https?:\/\//i.test(decoded) && MEDIA_EXT_RE.test(decoded)) {
        candidates.push(decoded);
      }
    } catch { /* ignore */ }
  }

  const best = pickBest(candidates.filter((u) => /^https?:\/\//i.test(u)));
  if (best) return best;

  // Iframe src — return so caller can recurse one level
  const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframe?.[1]) {
    const u = absolutize(baseUrl, iframe[1]);
    return { kind: "mp4", url: `__iframe__:${u}` };
  }
  return null;
}

function looksBlocked(status: number, body: string): boolean {
  if ([401, 403, 451, 503].includes(status)) return true;
  if (body.length < 4096 && BOT_GATE_MARKERS.test(body)) return true;
  return false;
}

interface FetchedPage {
  finalUrl: string;
  html: string;
  contentType: string;
  status: number;
  via: "direct" | "firecrawl";
  extraLinks?: string[];
}

async function firecrawlScrape(url: string): Promise<FetchedPage | null> {
  if (!FIRECRAWL_API_KEY) {
    logResolve("firecrawl: skipped (no FIRECRAWL_API_KEY)");
    return null;
  }
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["rawHtml", "links"],
        onlyMainContent: false,
        waitFor: 2500,
        location: { country: "IN", languages: ["en"] },
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = data?.error || res.statusText;
      logResolve("firecrawl: failed", res.status, err);
      if (res.status === 402) {
        throw new Error("Firecrawl credits exhausted; cannot bypass bot wall.");
      }
      return null;
    }
    // Firecrawl v2 returns either top-level or under .data
    const payload = data?.data ?? data ?? {};
    const html: string = payload.rawHtml || payload.html || "";
    const links: string[] = Array.isArray(payload.links) ? payload.links : [];
    const finalUrl: string = payload.metadata?.sourceURL || payload.metadata?.url || url;
    if (!html) {
      logResolve("firecrawl: empty html");
      return null;
    }
    logResolve("firecrawl: ok", { finalUrl, htmlLen: html.length, links: links.length });
    return { finalUrl, html, contentType: "text/html", status: 200, via: "firecrawl", extraLinks: links };
  } catch (e) {
    if (e instanceof Error && /credits exhausted/i.test(e.message)) throw e;
    logResolve("firecrawl: exception", e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function fetchPageHtml(url: string): Promise<FetchedPage> {
  // 1) Direct fetch first.
  let directRes: Response | null = null;
  let directBody = "";
  let directStatus = 0;
  let directCt = "";
  try {
    directRes = await fetch(url, {
      method: "GET",
      headers: { ...BROWSER_HEADERS, Referer: pageOrigin(url) },
      redirect: "follow",
    });
    directStatus = directRes.status;
    directCt = directRes.headers.get("content-type") ?? "";
    // If it's media, surface as a non-HTML page so caller short-circuits.
    if (classifyByContentType(directCt)) {
      await directRes.body?.cancel();
      return { finalUrl: directRes.url, html: "", contentType: directCt, status: directStatus, via: "direct" };
    }
    directBody = await directRes.text();
  } catch (e) {
    logResolve("direct: exception", e instanceof Error ? e.message : String(e));
  }

  const blocked = !directRes || looksBlocked(directStatus, directBody);
  if (!blocked && directRes) {
    logResolve("direct: ok", { status: directStatus, len: directBody.length });
    return { finalUrl: directRes.url, html: directBody, contentType: directCt, status: directStatus, via: "direct" };
  }
  logResolve("direct: blocked, falling back to firecrawl", { status: directStatus, len: directBody.length });

  // 2) Firecrawl fallback.
  const fc = await firecrawlScrape(url);
  if (fc) return fc;

  // 3) Firecrawl unavailable — return whatever direct gave us so extractor can still try.
  if (directRes) {
    return { finalUrl: directRes.url, html: directBody, contentType: directCt, status: directStatus, via: "direct" };
  }
  throw new Error(`Failed to fetch source and Firecrawl unavailable.`);
}

function filterLinksForMedia(links: string[]): string[] {
  return links.filter((u) => /^https?:\/\//i.test(u) && MEDIA_EXT_RE.test(u));
}

async function pickHlsVariant(masterUrl: string): Promise<{ url: string; encrypted: boolean }> {
  try {
    const res = await fetch(masterUrl, { headers: { ...BROWSER_HEADERS, Referer: pageOrigin(masterUrl) } });
    if (!res.ok) return { url: masterUrl, encrypted: false };
    const text = await res.text();
    const encrypted = /#EXT-X-KEY:[^\n]*METHOD=(?!NONE)[A-Z0-9-]+/i.test(text);
    if (!/#EXT-X-STREAM-INF/i.test(text)) {
      return { url: masterUrl, encrypted };
    }
    // Prefer an audio-only rendition (EXT-X-MEDIA TYPE=AUDIO with a URI).
    const audioMedia = text.match(/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI="([^"]+)"/i);
    if (audioMedia?.[1]) {
      logResolve("hls: picked audio-only rendition");
      return { url: absolutize(masterUrl, audioMedia[1]), encrypted };
    }
    // Otherwise: pick lowest-bandwidth video variant (smaller .ts download).
    const lines = text.split(/\r?\n/);
    let bestBw = Number.POSITIVE_INFINITY;
    let bestUri: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const bwMatch = line.match(/#EXT-X-STREAM-INF:[^\n]*BANDWIDTH=(\d+)/i);
      if (bwMatch) {
        const bw = Number(bwMatch[1]);
        const uri = (lines[i + 1] || "").trim();
        if (uri && !uri.startsWith("#") && bw < bestBw) {
          bestBw = bw;
          bestUri = uri;
        }
      }
    }
    const variant = bestUri ? absolutize(masterUrl, bestUri) : masterUrl;
    return { url: variant, encrypted };
  } catch {
    return { url: masterUrl, encrypted: false };
  }
}

async function resolveMediaUrl(input: string, depth = 0): Promise<ResolvedMedia> {
  if (depth > 1) return { kind: "none", reason: "Too many redirects through embed iframes." };
  if (isKnownUnsupported(input)) {
    return { kind: "none", reason: "YouTube/Vimeo embeds are not supported for transcription." };
  }

  // Quick win: extension says it's already media.
  const byExt = classifyByExt(input);
  if (byExt) {
    logResolve("by-ext", { kind: byExt, url: input });
    return { kind: byExt, url: input };
  }

  let page: FetchedPage;
  try {
    page = await fetchPageHtml(input);
  } catch (e) {
    return { kind: "none", reason: e instanceof Error ? e.message : String(e) };
  }

  // Page actually returned media (direct fetch short-circuit).
  if (!page.html && page.contentType) {
    const k = classifyByContentType(page.contentType);
    if (k) return { kind: k, url: page.finalUrl };
  }

  // Look inside the HTML.
  let found = findMediaInHtml(page.html, page.finalUrl);

  // Mix in Firecrawl-discovered links if extractor missed.
  if (!found && page.extraLinks?.length) {
    const links = filterLinksForMedia(page.extraLinks);
    const best = pickBest(links);
    if (best) {
      logResolve("matched via firecrawl links", best);
      found = best;
    }
  }

  if (!found) {
    if (page.status >= 400) {
      return { kind: "none", reason: `Source returned ${page.status} and no media URL was found in the page.` };
    }
    return { kind: "none", reason: "No direct media file found inside the page." };
  }

  if (found.url.startsWith("__iframe__:")) {
    const iframeUrl = found.url.slice("__iframe__:".length);
    logResolve("iframe-recurse", iframeUrl);
    return resolveMediaUrl(iframeUrl, depth + 1);
  }

  logResolve("found media", found, "via", page.via);

  // For HLS, inspect the manifest: pick best variant, reject DRM.
  if (found.kind === "hls") {
    const { url, encrypted } = await pickHlsVariant(found.url);
    if (encrypted) {
      return { kind: "none", reason: "DRM/encrypted HLS stream — cannot transcribe." };
    }
    return { kind: "hls", url };
  }

  return found;
}

function groupWords(words: Word[]): Segment[] {
  const segs: Segment[] = [];
  let cur: { start: number; end: number; texts: string[]; speaker?: string } | null = null;
  const MAX_DUR = 5;
  const flush = () => {
    if (cur && cur.texts.length) {
      const text = cur.texts.join("").replace(/\s+/g, " ").trim();
      if (text) segs.push({ start: +cur.start.toFixed(2), end: +cur.end.toFixed(2), text, speaker: cur.speaker });
    }
    cur = null;
  };
  for (const w of words) {
    if (w.type && w.type !== "word" && w.type !== "spacing") continue;
    const speaker = w.speaker_id;
    if (!cur) { cur = { start: w.start, end: w.end, texts: [w.text], speaker }; continue; }
    const tooLong = (w.end - cur.start) > MAX_DUR;
    const speakerChange = speaker && cur.speaker && speaker !== cur.speaker;
    const endsSentence = /[.!?]$/.test(cur.texts.join("").trim()) && (w.end - cur.start) > 1.5;
    if (tooLong || speakerChange || endsSentence) {
      flush();
      cur = { start: w.start, end: w.end, texts: [w.text], speaker };
    } else {
      cur.texts.push(w.text);
      cur.end = w.end;
    }
  }
  flush();
  return segs;
}

function extractYouTubeId(url: string | null): string | null {
  if (!url) return null;
  return url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1] ?? null;
}

function decodeEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function parseYouTubeTranscriptXml(xml: string): Segment[] {
  const segments: Segment[] = [];
  for (const match of xml.matchAll(/<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const start = Number(match[1]) / 1000;
    const end = start + Number(match[2]) / 1000;
    const text = decodeEntities(match[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    if (text) segments.push({ start, end, text, speaker: "YouTube captions" });
  }
  if (segments.length) return segments;

  for (const match of xml.matchAll(/<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g)) {
    const start = Number(match[1]);
    const end = start + Number(match[2]);
    const text = decodeEntities(match[3]).replace(/\s+/g, " ").trim();
    if (text) segments.push({ start, end, text, speaker: "YouTube captions" });
  }
  return segments;
}

async function transcribeYouTubeCaptions(videoUrl: string): Promise<Segment[] | null> {
  const videoId = extractYouTubeId(videoUrl);
  if (!videoId) return null;

  const playerRes = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
    },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
      videoId,
    }),
  });
  if (!playerRes.ok) return null;
  const player = await playerRes.json();
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || !tracks.length) return null;
  const track = tracks.find((t: any) => t.languageCode === "en") ?? tracks[0];
  const captionUrl = track?.baseUrl;
  if (!captionUrl || !/^https:\/\/(?:www\.)?youtube\.com\//i.test(captionUrl)) return null;

  const captionRes = await fetch(captionUrl, { headers: BROWSER_HEADERS });
  if (!captionRes.ok) return null;
  const xml = await captionRes.text();
  const segments = parseYouTubeTranscriptXml(xml);
  return segments.length ? segments : null;
}

async function transcribeBlobWithElevenLabs(blob: Blob, filename: string, contentType: string): Promise<Segment[]> {
  const form = new FormData();
  form.append("file", new File([blob], filename, { type: contentType }));
  form.append("model_id", "scribe_v1");
  form.append("diarize", "true");
  form.append("timestamps_granularity", "word");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
    body: form,
  });
  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 401 && /invalid_api_key|missing_permissions|speech_to_text/i.test(errorText)) {
      throw new ElevenLabsConfigurationError();
    }
    throw new Error(`ElevenLabs STT ${res.status}: ${errorText}`);
  }
  const data = await res.json();
  const words: Word[] = data.words ?? [];
  if (!words.length && data.text) return [{ start: 0, end: 0, text: data.text }];
  return groupWords(words);
}

async function transcribeMp4WithElevenLabs(mediaUrl: string): Promise<Segment[]> {
  const mediaRes = await fetch(mediaUrl, {
    headers: { ...BROWSER_HEADERS, Referer: pageOrigin(mediaUrl) },
    redirect: "follow",
  });
  if (!mediaRes.ok) throw new Error(`Failed to download media (${mediaRes.status})`);
  const ct = mediaRes.headers.get("content-type") ?? "video/mp4";
  if (!classifyByContentType(ct)) {
    throw new Error(`Resolved URL did not return media (content-type: ${ct})`);
  }
  const blob = await mediaRes.blob();
  return transcribeBlobWithElevenLabs(blob, "video.mp4", ct);
}

async function transcribeUrlWithElevenLabs(mediaUrl: string): Promise<Segment[]> {
  // Ask ElevenLabs to fetch the media itself (handles HLS, signed URLs, etc.)
  const form = new FormData();
  form.append("cloud_storage_url", mediaUrl);
  form.append("model_id", "scribe_v1");
  form.append("diarize", "true");
  form.append("timestamps_granularity", "word");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
    body: form,
  });
  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 401 && /invalid_api_key|missing_permissions|speech_to_text/i.test(errorText)) {
      throw new ElevenLabsConfigurationError();
    }
    throw new Error(`ElevenLabs STT (cloud_storage_url) ${res.status}: ${errorText}`);
  }
  const data = await res.json();
  const words: Word[] = data.words ?? [];
  if (!words.length && data.text) return [{ start: 0, end: 0, text: data.text }];
  return groupWords(words);
}

async function transcribeHlsWithElevenLabs(hlsUrl: string): Promise<Segment[]> {
  // First attempt: let ElevenLabs ingest the HLS URL directly.
  try {
    const segs = await transcribeUrlWithElevenLabs(hlsUrl);
    if (segs.length) return segs;
    console.log("ElevenLabs cloud_storage_url returned no segments; falling back to manual download.");
  } catch (e) {
    if (e instanceof ElevenLabsConfigurationError) throw e;
    console.warn("ElevenLabs cloud_storage_url failed, falling back:", e instanceof Error ? e.message : String(e));
  }

  const manifestRes = await fetch(hlsUrl, { headers: { ...BROWSER_HEADERS, Referer: pageOrigin(hlsUrl) } });
  if (!manifestRes.ok) throw new Error(`Failed to download HLS manifest (${manifestRes.status})`);
  const manifest = await manifestRes.text();
  if (/#EXT-X-KEY:[^\n]*METHOD=(?!NONE)[A-Z0-9-]+/i.test(manifest)) {
    throw new Error("DRM/encrypted HLS stream cannot be transcribed.");
  }

  const refs = manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!refs.length) throw new Error("HLS manifest contains no media segments.");
  if (refs.some((ref) => /\.m3u8(\?|#|$)/i.test(ref))) {
    return transcribeHlsWithElevenLabs(absolutize(hlsUrl, refs.find((ref) => /\.m3u8(\?|#|$)/i.test(ref)) ?? refs[0]));
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const maxBytes = 80 * 1024 * 1024;
  for (const ref of refs) {
    const segmentUrl = absolutize(hlsUrl, ref);
    const res = await fetch(segmentUrl, { headers: { ...BROWSER_HEADERS, Referer: pageOrigin(hlsUrl) } });
    if (!res.ok) throw new Error(`Failed to download HLS segment (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    total += bytes.byteLength;
    if (total > maxBytes) throw new Error("HLS media is too large to transcribe in one request.");
    chunks.push(bytes);
  }

  return transcribeBlobWithElevenLabs(new Blob(chunks, { type: "video/mp2t" }), "kpoint-video.ts", "video/mp2t");
}

async function transcribeBytesWithGemini(bytes: Uint8Array, mimeType: string): Promise<Segment[]> {
  const { encodeBase64 } = await import("https://deno.land/std@0.224.0/encoding/base64.ts");
  const b64 = encodeBase64(bytes);
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const tool = {
    type: "function",
    function: {
      name: "submit_transcript",
      description: "Submit the transcript of the video as ordered segments.",
      parameters: {
        type: "object",
        properties: {
          segments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                start: { type: "number" },
                end: { type: "number" },
                text: { type: "string" },
                speaker: { type: "string" },
              },
              required: ["start", "end", "text"],
              additionalProperties: false,
            },
          },
        },
        required: ["segments"],
        additionalProperties: false,
      },
    },
  } as const;

  const body = {
    model: "google/gemini-2.5-pro",
    messages: [
      {
        role: "system",
        content:
          "You are a transcription engine. Listen to the provided video/audio and return an accurate, diarized transcript with realistic timestamps in seconds. Break into ~3-6 second segments at natural pauses or speaker changes. Transcribe only what is actually spoken.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this audio by calling submit_transcript." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    tools: [tool],
    tool_choice: { type: "function", function: { name: "submit_transcript" } },
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini transcription ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("Gemini did not return a transcript");
  const parsed = JSON.parse(call.function.arguments);
  const segs: Segment[] = (parsed.segments ?? []).map((s: any) => ({
    start: Number(s.start) || 0,
    end: Number(s.end) || 0,
    text: String(s.text ?? "").trim(),
    speaker: s.speaker ? String(s.speaker) : undefined,
  })).filter((s) => s.text);
  return segs;
}

async function downloadHlsBytes(hlsUrl: string): Promise<Uint8Array> {
  const manifestRes = await fetch(hlsUrl, { headers: { ...BROWSER_HEADERS, Referer: pageOrigin(hlsUrl) } });
  if (!manifestRes.ok) throw new Error(`Failed to download HLS manifest (${manifestRes.status})`);
  const manifest = await manifestRes.text();
  if (/#EXT-X-KEY:[^\n]*METHOD=(?!NONE)[A-Z0-9-]+/i.test(manifest)) {
    throw new Error("DRM/encrypted HLS stream cannot be transcribed.");
  }
  const refs = manifest.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!refs.length) throw new Error("HLS manifest contains no media segments.");
  if (refs.some((r) => /\.m3u8(\?|#|$)/i.test(r))) {
    return downloadHlsBytes(absolutize(hlsUrl, refs.find((r) => /\.m3u8(\?|#|$)/i.test(r)) ?? refs[0]));
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const maxBytes = 30 * 1024 * 1024;
  for (const ref of refs) {
    const segmentUrl = absolutize(hlsUrl, ref);
    const res = await fetch(segmentUrl, { headers: { ...BROWSER_HEADERS, Referer: pageOrigin(hlsUrl) } });
    if (!res.ok) throw new Error(`Failed to download HLS segment (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    total += bytes.byteLength;
    if (total > maxBytes) throw new Error("HLS media is too large to transcribe in one request.");
    chunks.push(bytes);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
  return merged;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  let taskId: string | undefined;
  try {
    const body = await req.json();
    taskId = body.taskId;
    const videoUrl: string | null = body.videoUrl ?? null;
    const mediaUrlOverride: string | null = body.mediaUrlOverride ?? null;
    if (!taskId) throw new Error("taskId required");

    // Idempotency: if already ready and we have a cached media_url, skip (unless explicit override).
    if (!mediaUrlOverride) {
      const { data: existing } = await supabase
        .from("qc_tasks")
        .select("transcript_status, media_url")
        .eq("id", taskId)
        .maybeSingle();
      if (existing?.transcript_status === "ready" && existing.media_url) {
        return new Response(JSON.stringify({ ok: true, status: "ready", cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const sourceUrl = mediaUrlOverride || videoUrl;
    if (!sourceUrl) {
      await supabase.from("qc_tasks").update({
        transcript: [], transcript_status: "unsupported_source",
        error_message: "No video URL available for transcription.",
      }).eq("id", taskId);
      return new Response(JSON.stringify({ ok: true, status: "unsupported_source" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("qc_tasks").update({ transcript_status: "pending" }).eq("id", taskId);

    if (!mediaUrlOverride) {
      const youtubeSegments = await transcribeYouTubeCaptions(sourceUrl);
      if (youtubeSegments?.length) {
        await supabase.from("qc_tasks").update({
          transcript: youtubeSegments,
          transcript_status: "ready",
          media_url: sourceUrl,
          media_kind: null,
          error_message: null,
        }).eq("id", taskId);

        return new Response(JSON.stringify({ ok: true, count: youtubeSegments.length, kind: "youtube-captions" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const resolved = await resolveMediaUrl(sourceUrl);
    if (resolved.kind === "none") {
      await supabase.from("qc_tasks").update({
        transcript: [], transcript_status: "unsupported_source",
        error_message: resolved.reason,
      }).eq("id", taskId);
      return new Response(JSON.stringify({ ok: true, status: "unsupported_source", reason: resolved.reason }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("qc_tasks").update({
      media_url: resolved.url,
      media_kind: resolved.kind,
    }).eq("id", taskId);

    let segments: Segment[] = [];
    if (resolved.kind === "mp4") {
      try {
        segments = await transcribeMp4WithElevenLabs(resolved.url);
      } catch (err) {
        if (err instanceof ElevenLabsConfigurationError) throw err;
        console.warn("ElevenLabs mp4 failed, falling back to Gemini:", err instanceof Error ? err.message : String(err));
      }
      if (!segments.length) {
        const mp4Res = await fetch(resolved.url, { headers: { ...BROWSER_HEADERS, Referer: pageOrigin(resolved.url) } });
        if (!mp4Res.ok) throw new Error(`Failed to download media (${mp4Res.status})`);
        const bytes = new Uint8Array(await mp4Res.arrayBuffer());
        segments = await transcribeBytesWithGemini(bytes, mp4Res.headers.get("content-type") ?? "video/mp4");
      }
    } else {
      try {
        segments = await transcribeHlsWithElevenLabs(resolved.url);
      } catch (err) {
        if (err instanceof ElevenLabsConfigurationError) throw err;
        console.warn("ElevenLabs HLS failed, falling back to Gemini:", err instanceof Error ? err.message : String(err));
      }
      if (!segments.length) {
        console.log("Falling back to Gemini for HLS transcription.");
        const bytes = await downloadHlsBytes(resolved.url);
        segments = await transcribeBytesWithGemini(bytes, "video/mp2t");
      }
    }
    if (!segments.length) {
      throw new Error("Transcription returned no segments. The audio may be silent or unsupported.");
    }

    await supabase.from("qc_tasks").update({
      transcript: segments,
      transcript_status: "ready",
      error_message: null,
    }).eq("id", taskId);

    return new Response(JSON.stringify({ ok: true, count: segments.length, kind: resolved.kind }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("transcribe-video error:", msg);
    if (e instanceof ElevenLabsConfigurationError) {
      if (taskId) {
        await supabase.from("qc_tasks").update({
          transcript_status: "unsupported_source",
          transcript: [],
          error_message: "ElevenLabs speech-to-text is not available with the configured API key. Add a valid key with speech_to_text permission, or paste/import a transcript manually.",
        }).eq("id", taskId);
      }
      return new Response(JSON.stringify({
        ok: true,
        status: "unsupported_source",
        reason: "ElevenLabs speech-to-text is not available with the configured API key.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (taskId) {
      await supabase.from("qc_tasks").update({
        transcript_status: "failed",
        transcript: [],
        error_message: msg,
      }).eq("id", taskId);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
