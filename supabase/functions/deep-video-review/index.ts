// deep-video-review: REAL video QC using Google AI Files API.
// Supports videos up to ~2GB / 1hr. Server-side downloads the video,
// uploads to Google's File API (resumable), polls until ACTIVE, then
// asks Gemini 2.5 Pro to actually watch it (visuals + audio + supers).

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const MEDIA_EXT_RE = /\.(mp4|m4a|m4v|mp3|webm|wav|ogg|mov|m3u8)(\?|#|$)/i;
const BOT_GATE_MARKERS = /access denied|reference #|just a moment|attention required|cf-browser-verification|cf-chl-bypass|cloudflare|akamai|forbidden/i;

type ResolvedMedia =
  | { kind: "mp4"; url: string }
  | { kind: "hls"; url: string }
  | { kind: "none"; reason: string };

function logResolve(...args: unknown[]) { console.log("[resolve]", ...args); }

function classifyByExt(url: string): "mp4" | "hls" | null {
  if (/\.(mp4|m4a|m4v|mp3|webm|wav|ogg|mov)(\?|#|$)/i.test(url)) return "mp4";
  if (/\.m3u8(\?|#|$)/i.test(url)) return "hls";
  return null;
}
function classifyByContentType(ct: string): "mp4" | "hls" | null {
  const t = ct.toLowerCase();
  if (t.includes("mpegurl") || t.includes("vnd.apple.mpegurl")) return "hls";
  if (t.startsWith("video/") || t.startsWith("audio/")) return "mp4";
  if (t === "application/octet-stream") return "mp4";
  return null;
}
function decodeMediaUrl(raw: string): string {
  return raw
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/gi, "&")
    .replace(/\\\//g, "/");
}
function absolutize(base: string, ref: string): string {
  const cleaned = decodeMediaUrl(ref);
  try { return new URL(cleaned, base).toString(); } catch { return cleaned; }
}
function pageOrigin(url: string): string { try { return new URL(url).origin + "/"; } catch { return url; } }

function collectMediaFromJson(value: unknown, out: string[]) {
  if (!value) return;
  if (typeof value === "string") {
    const cleaned = decodeMediaUrl(value);
    if (/^https?:\/\//i.test(cleaned) && MEDIA_EXT_RE.test(cleaned)) out.push(cleaned);
    return;
  }
  if (Array.isArray(value)) { for (const v of value) collectMediaFromJson(v, out); return; }
  if (typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) collectMediaFromJson(v, out);
}
function pickBest(cands: string[]): { kind: "mp4" | "hls"; url: string } | null {
  const mp4 = cands.find((u) => classifyByExt(u) === "mp4");
  if (mp4) return { kind: "mp4", url: mp4 };
  const hls = cands.find((u) => classifyByExt(u) === "hls");
  if (hls) return { kind: "hls", url: hls };
  return null;
}
function findMediaInHtml(html: string, baseUrl: string): { kind: "mp4" | "hls"; url: string } | null {
  const c: string[] = [];
  for (const m of html.matchAll(/<meta[^>]+property=["']og:(?:video|audio)(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/gi)) c.push(absolutize(baseUrl, m[1]));
  for (const m of html.matchAll(/<(?:source|video|audio)[^>]+src=["']([^"']+)["']/gi)) c.push(absolutize(baseUrl, m[1]));
  for (const m of html.matchAll(/\sdata-(?:src|hls|mp4|video-url|stream|playback-url|manifest)=["']([^"']+)["']/gi)) c.push(absolutize(baseUrl, m[1]));
  // JSON-LD
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1]); const cc: string[] = []; collectMediaFromJson(j, cc); for (const x of cc) c.push(absolutize(baseUrl, x)); } catch {}
  }
  // Generic <script> JSON blobs
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const s = m[1]; if (!s || s.length > 500_000) continue;
    const trimmed = s.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { const j = JSON.parse(trimmed); const cc: string[] = []; collectMediaFromJson(j, cc); for (const x of cc) c.push(absolutize(baseUrl, x)); } catch {}
    }
    for (const inner of s.matchAll(/JSON\.parse\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*\)/g)) {
      try {
        const decoded = inner[2].replace(/\\(["'\\nrtbf/])/g, (_m, ch) => {
          const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
          return map[ch] ?? ch;
        });
        const j = JSON.parse(decoded); const cc: string[] = []; collectMediaFromJson(j, cc);
        for (const x of cc) c.push(absolutize(baseUrl, x));
      } catch {}
    }
  }
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\]+\.(?:mp4|m4a|m4v|mp3|webm|wav|ogg|mov)(?:\?[^\s"'<>\\]*)?/gi)) c.push(m[0]);
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/gi)) c.push(m[0]);
  // Escaped URLs in JSON (\/)
  for (const m of html.matchAll(/https?:\\?\/\\?\/[^"'\s<>)]+\.(?:mp4|webm|mov|m3u8|m4a|m4v|mp3|ogg|wav)(?:\?[^"'\s<>)]*)?/gi)) c.push(decodeMediaUrl(m[0]));
  // Base64-hidden URLs
  for (const m of html.matchAll(/["']([A-Za-z0-9+/=]{60,})["']/g)) {
    try { const decoded = decodeMediaUrl(atob(m[1])); if (/^https?:\/\//i.test(decoded) && MEDIA_EXT_RE.test(decoded)) c.push(decoded); } catch {}
  }
  const best = pickBest(c.filter((u) => /^https?:\/\//i.test(u)));
  if (best) return best;
  const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframe?.[1]) return { kind: "mp4", url: `__iframe__:${absolutize(baseUrl, iframe[1])}` };
  return null;
}
function looksBlocked(status: number, body: string): boolean {
  if ([401, 403, 451, 503].includes(status)) return true;
  if (body.length < 4096 && BOT_GATE_MARKERS.test(body)) return true;
  return false;
}

interface FetchedPage { finalUrl: string; html: string; contentType: string; status: number; via: "direct" | "firecrawl"; extraLinks?: string[]; }

async function firecrawlScrape(url: string): Promise<FetchedPage | null> {
  if (!FIRECRAWL_API_KEY) { logResolve("firecrawl: skipped (no key)"); return null; }
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["rawHtml", "links"], onlyMainContent: false, waitFor: 2500, location: { country: "IN", languages: ["en"] } }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) { logResolve("firecrawl: failed", res.status, data?.error); return null; }
    const p = data?.data ?? data ?? {};
    const html: string = p.rawHtml || p.html || "";
    const links: string[] = Array.isArray(p.links) ? p.links : [];
    const finalUrl: string = p.metadata?.sourceURL || p.metadata?.url || url;
    if (!html && !links.length) return null;
    logResolve("firecrawl: ok", { finalUrl, htmlLen: html.length, links: links.length });
    return { finalUrl, html, contentType: "text/html", status: 200, via: "firecrawl", extraLinks: links };
  } catch (e) { logResolve("firecrawl: exception", e instanceof Error ? e.message : String(e)); return null; }
}

async function fetchPageHtml(url: string): Promise<FetchedPage> {
  let directRes: Response | null = null; let body = ""; let status = 0; let ct = "";
  try {
    directRes = await fetch(url, { headers: { ...BROWSER_HEADERS, Referer: pageOrigin(url) }, redirect: "follow" });
    status = directRes.status; ct = directRes.headers.get("content-type") ?? "";
    if (classifyByContentType(ct)) { await directRes.body?.cancel(); return { finalUrl: directRes.url, html: "", contentType: ct, status, via: "direct" }; }
    body = await directRes.text();
  } catch (e) { logResolve("direct: exception", e instanceof Error ? e.message : String(e)); }
  const blocked = !directRes || looksBlocked(status, body);
  if (!blocked && directRes) { logResolve("direct: ok", { status, len: body.length }); return { finalUrl: directRes.url, html: body, contentType: ct, status, via: "direct" }; }
  logResolve("direct: blocked, falling back to firecrawl", { status, len: body.length });
  const fc = await firecrawlScrape(url);
  if (fc) return fc;
  if (directRes) return { finalUrl: directRes.url, html: body, contentType: ct, status, via: "direct" };
  throw new Error("Failed to fetch source and Firecrawl unavailable.");
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
    if (!/#EXT-X-STREAM-INF/i.test(text)) return { url: masterUrl, encrypted };
    const lines = text.split(/\r?\n/);
    let bestBw = -1, bestUri: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const bw = lines[i].match(/#EXT-X-STREAM-INF:[^\n]*BANDWIDTH=(\d+)/i);
      if (bw) {
        const uri = (lines[i + 1] || "").trim();
        if (uri && !uri.startsWith("#") && Number(bw[1]) > bestBw) { bestBw = Number(bw[1]); bestUri = uri; }
      }
    }
    return { url: bestUri ? absolutize(masterUrl, bestUri) : masterUrl, encrypted };
  } catch { return { url: masterUrl, encrypted: false }; }
}

async function downloadHlsBytes(hlsUrl: string): Promise<Uint8Array> {
  const manifestRes = await fetch(hlsUrl, { headers: { ...BROWSER_HEADERS, Referer: pageOrigin(hlsUrl) } });
  if (!manifestRes.ok) throw new Error(`Failed to download HLS manifest (${manifestRes.status}). The signed CDN URL may have expired — retry Deep Review or use Live Capture.`);
  const manifest = await manifestRes.text();
  if (/#EXT-X-KEY:[^\n]*METHOD=(?!NONE)[A-Z0-9-]+/i.test(manifest)) throw new Error("DRM/encrypted HLS stream — use Live Capture instead.");
  const refs = manifest.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (!refs.length) throw new Error("HLS manifest contains no playable media segments — use Live Capture.");
  const nested = refs.find((ref) => /\.m3u8(\?|#|$)/i.test(ref));
  if (nested) return downloadHlsBytes(absolutize(hlsUrl, nested));

  const chunks: Uint8Array[] = [];
  let total = 0;
  const maxBytes = 950 * 1024 * 1024;
  for (const ref of refs) {
    const segmentUrl = absolutize(hlsUrl, ref);
    const res = await fetch(segmentUrl, { headers: { ...BROWSER_HEADERS, Referer: pageOrigin(hlsUrl) } });
    if (!res.ok) throw new Error(`Failed to download HLS segment (${res.status}). The host may block server-side downloads — use Live Capture.`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    total += bytes.byteLength;
    if (total > maxBytes) throw new Error("HLS stream is too large for Deep Review download — use Live Capture for this long video.");
    chunks.push(bytes);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return merged;
}

let ffmpegInstance: any = null;
async function remuxTransportStreamToMp4(bytes: Uint8Array): Promise<Uint8Array> {
  if (!ffmpegInstance) {
    const mod: any = await import("https://esm.sh/@ffmpeg/ffmpeg@0.12.10?bundle");
    const FFmpeg = mod.FFmpeg ?? mod.default?.FFmpeg;
    ffmpegInstance = new FFmpeg();
    await ffmpegInstance.load({
      coreURL: "https://esm.sh/@ffmpeg/core-st@0.12.6/dist/umd/ffmpeg-core.js",
      wasmURL: "https://esm.sh/@ffmpeg/core-st@0.12.6/dist/umd/ffmpeg-core.wasm",
    });
  }
  const suffix = crypto.randomUUID();
  const inputName = `input-${suffix}.ts`;
  const outputName = `output-${suffix}.mp4`;
  await ffmpegInstance.writeFile(inputName, bytes);
  await ffmpegInstance.exec(["-i", inputName, "-c", "copy", "-movflags", "faststart", outputName]);
  const out = await ffmpegInstance.readFile(outputName);
  try { await ffmpegInstance.deleteFile(inputName); } catch {}
  try { await ffmpegInstance.deleteFile(outputName); } catch {}
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

async function resolveMediaUrl(input: string, depth = 0): Promise<ResolvedMedia> {
  if (depth > 2) return { kind: "none", reason: "Too many embed redirects." };
  if (/youtube\.com|youtu\.be|vimeo\.com/i.test(input)) return { kind: "none", reason: "YouTube/Vimeo not supported here — use Live Capture." };
  const byExt = classifyByExt(input);
  if (byExt) { logResolve("by-ext", { kind: byExt, url: input }); return { kind: byExt, url: input }; }
  let page: FetchedPage;
  try { page = await fetchPageHtml(input); } catch (e) { return { kind: "none", reason: e instanceof Error ? e.message : String(e) }; }
  if (!page.html && page.contentType) {
    const k = classifyByContentType(page.contentType);
    if (k) return { kind: k, url: page.finalUrl };
  }
  let found = findMediaInHtml(page.html, page.finalUrl);
  if (!found && page.extraLinks?.length) {
    const best = pickBest(filterLinksForMedia(page.extraLinks));
    if (best) { logResolve("matched via firecrawl links", best); found = best; }
  }
  if (!found) {
    const isKpoint = /kpoint|videos\.bajajfinserv\.in/i.test(page.finalUrl) || /kpoint|videos\.bajajfinserv\.in/i.test(input);
    if (isKpoint) return { kind: "none", reason: "Bajaj kapsule (kpoint) videos use signed/dynamic CDN URLs that aren't exposed in HTML. Use Live Capture to record the player in-browser." };
    if (page.status >= 400) return { kind: "none", reason: `Source returned ${page.status} and no media URL found.` };
    return { kind: "none", reason: "No direct media file found inside the page. If it's a DRM stream, use Live Capture." };
  }
  if (found.url.startsWith("__iframe__:")) return resolveMediaUrl(found.url.slice("__iframe__:".length), depth + 1);
  logResolve("found media", found, "via", page.via);
  if (found.kind === "hls") {
    const { url, encrypted } = await pickHlsVariant(found.url);
    if (encrypted) return { kind: "none", reason: "DRM/encrypted HLS stream — use Live Capture instead." };
    return { kind: "hls", url };
  }
  return found;
}
const MODEL = "gemini-2.5-pro";
const SEVERITY_WEIGHTS: Record<string, number> = { critical: 25, high: 15, medium: 8, low: 3 };

const QC_SCHEMA = {
  type: "object",
  properties: {
    analysis_summary: { type: "string" },
    what_a_user_feels: { type: "string" },
    customer_intent: { type: "string" },
    topic_match_score: { type: "integer" },
    bucket_scores: {
      type: "object",
      properties: {
        technical: { type: "integer" },
        brand: { type: "integer" },
        strategic: { type: "integer" },
        contextual: { type: "integer" },
      },
      required: ["technical", "brand", "strategic", "contextual"],
    },
    transcript: {
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
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          bucket: { type: "string", enum: ["technical", "brand", "strategic", "contextual"] },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          timestamp_sec: { type: "number" },
          title: { type: "string" },
          description: { type: "string" },
          suggested_fix: { type: "string" },
        },
        required: ["bucket", "severity", "timestamp_sec", "title", "description", "suggested_fix"],
      },
    },
    key_frames: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timestamp_sec: { type: "number" },
          label: { type: "string" },
          suggested_fix: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
        },
        required: ["timestamp_sec", "label", "severity"],
      },
    },
  },
  required: ["analysis_summary", "what_a_user_feels", "customer_intent", "topic_match_score", "bucket_scores", "transcript", "issues", "key_frames"],
};

function computeOverall(b: any, issues: any[]) {
  const penalty: Record<string, number> = { technical: 0, brand: 0, strategic: 0, contextual: 0 };
  for (const i of issues) penalty[i.bucket] = (penalty[i.bucket] ?? 0) + (SEVERITY_WEIGHTS[i.severity] ?? 0);
  const adj = {
    technical: Math.max(0, b.technical - Math.min(40, penalty.technical * 0.4)),
    brand: Math.max(0, b.brand - Math.min(40, penalty.brand * 0.4)),
    strategic: Math.max(0, b.strategic - Math.min(40, penalty.strategic * 0.4)),
    contextual: Math.max(0, b.contextual - Math.min(40, penalty.contextual * 0.4)),
  };
  const overall = Math.round(adj.technical * 0.25 + adj.brand * 0.30 + adj.strategic * 0.20 + adj.contextual * 0.25);
  return { adjusted: adj, overall };
}

// Upload bytes to Google AI Files API (resumable protocol)
async function uploadToFilesApi(bytes: Uint8Array, mime: string, displayName: string) {
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GOOGLE_AI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
        "X-Goog-Upload-Header-Content-Type": mime,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    },
  );
  if (!startRes.ok) throw new Error(`Files API start failed (${startRes.status}): ${await startRes.text()}`);
  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Files API: no upload URL returned");

  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });
  if (!upRes.ok) throw new Error(`Files API upload failed (${upRes.status}): ${await upRes.text()}`);
  const fileInfo = await upRes.json();
  return fileInfo.file as { name: string; uri: string; mimeType: string; state: string };
}

async function waitUntilActive(name: string, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}?key=${GOOGLE_AI_API_KEY}`);
    if (!r.ok) throw new Error(`Files API status check failed: ${await r.text()}`);
    const f = await r.json();
    if (f.state === "ACTIVE") return f;
    if (f.state === "FAILED") throw new Error("Google AI failed to process the video.");
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error("Timed out waiting for video processing.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let taskId: string | undefined;
  try {
    if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY is not configured.");
    const body = await req.json();
    taskId = body.taskId;
    const { videoUrl, pageContext, persona } = body;
    if (!taskId || !videoUrl) throw new Error("taskId and videoUrl required");

    // 1) Resolve to a direct media URL (handles Akamai-protected Bajaj kapsule embeds via Firecrawl-IN fallback)
    console.log("Resolving media URL:", videoUrl);
    const resolved = await resolveMediaUrl(videoUrl);
    if (resolved.kind === "none") {
      throw new Error(resolved.reason);
    }
    console.log("Resolved to:", resolved.url);
    await supabase.from("qc_tasks").update({ media_url: resolved.url, media_kind: resolved.kind, status: "processing", error_message: null }).eq("id", taskId);

    // 2) Download video bytes
    let ct = "video/mp4";
    let buf: Uint8Array;
    if (resolved.kind === "hls") {
      buf = await downloadHlsBytes(resolved.url);
      ct = "video/mp2t";
    } else {
      const vRes = await fetch(resolved.url, { redirect: "follow", headers: { ...BROWSER_HEADERS, Referer: pageOrigin(resolved.url), Accept: "video/*,*/*" } });
      if (!vRes.ok) throw new Error(`Could not fetch resolved video (${vRes.status}). Host may block server-side downloads — try Live Capture.`);
      ct = (vRes.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const urlExt = resolved.url.split("?")[0].split("#")[0].toLowerCase();
      if (!ct || ct === "application/octet-stream" || !/^video\//i.test(ct)) {
        ct = urlExt.endsWith(".webm") ? "video/webm" : "video/mp4";
      }
      buf = new Uint8Array(await vRes.arrayBuffer());
    }
    console.log(`Downloaded ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB (${ct})`);

    // 2) Upload to Google AI Files API
    const file = await uploadToFilesApi(buf, ct, `qc-${taskId}`);
    console.log("Uploaded:", file.name, "state:", file.state);

    // 3) Wait until ACTIVE (Google processes the video)
    const active = await waitUntilActive(file.name);
    console.log("File ACTIVE:", active.uri);

    // 4) Ask Gemini 2.5 Pro to watch it
    const systemPrompt = `You are a senior Video QC reviewer for Bajaj Finance, a major Indian financial services brand. You can SEE and HEAR the attached video. Behave like a real human reviewer:

- Watch end-to-end FRAME-BY-FRAME. Note REAL timestamps (in seconds) for everything you flag.
- Produce a FULL TIMESTAMPED TRANSCRIPT of all spoken voiceover/dialogue (Hindi/English/Hinglish ok — keep the original language). Break into short segments of 3-8 seconds. Include speaker if obvious.
- OCR every super, lower-third, CTA, price, EMI, T&C, RBI line, disclaimer.
- Listen to the voiceover. Flag voice/visual mismatches, unclear pronunciation, missing CTA, missing legal copy.
- Judge pacing: hook in first 3 seconds? Does the message land? Does the CTA arrive too late?
- Brand: Bajaj Finance logo present? Brand colors (deep blue / white)? Persona consistent?
- Be strict. Do NOT invent issues. Only flag what you actually see or hear.

Score buckets 0-100: Technical, Brand, Strategic, Contextual. Return 4-12 grounded issues with REAL timestamps and 4-8 key_frames. Transcript MUST cover the entire video.`;

    const userText = `${persona ? `PERSONA: ${persona}\n\n` : ""}LANDING PAGE CONTEXT:\n${(pageContext ?? "").slice(0, 4000)}\n\nWatch the attached video and return your honest QC review as JSON.`;

    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            {
              role: "user",
              parts: [
                { fileData: { mimeType: active.mimeType, fileUri: active.uri } },
                { text: userText },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: QC_SCHEMA,
            temperature: 0.4,
          },
        }),
      },
    );

    if (!genRes.ok) {
      const t = await genRes.text();
      throw new Error(`Gemini ${genRes.status}: ${t.slice(0, 500)}`);
    }
    const gen = await genRes.json();
    const text = gen.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no content. " + JSON.stringify(gen).slice(0, 300));
    const parsed = JSON.parse(text);

    // 5) Cleanup uploaded file (best-effort)
    fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${GOOGLE_AI_API_KEY}`, { method: "DELETE" }).catch(() => {});

    // 6) Persist
    await supabase.from("qc_issues").delete().eq("task_id", taskId);
    if (parsed.issues?.length) {
      await supabase.from("qc_issues").insert(parsed.issues.map((i: any) => ({ ...i, task_id: taskId })));
    }
    const { adjusted, overall } = computeOverall(parsed.bucket_scores, parsed.issues || []);
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of parsed.issues || []) (counts as any)[i.severity]++;

    await supabase.from("qc_tasks").update({
      status: "completed",
      customer_intent: parsed.customer_intent,
      topic_match_score: parsed.topic_match_score,
      analysis_summary: `${parsed.analysis_summary}\n\nWhat a user feels: ${parsed.what_a_user_feels}`,
      technical_score: Math.round(adjusted.technical),
      brand_score: Math.round(adjusted.brand),
      strategic_score: Math.round(adjusted.strategic),
      contextual_score: Math.round(adjusted.contextual),
      overall_score: overall,
      critical_count: counts.critical,
      high_count: counts.high,
      medium_count: counts.medium,
      low_count: counts.low,
      key_frames: parsed.key_frames ?? [],
      transcript: parsed.transcript ?? [],
      transcript_status: parsed.transcript?.length ? "ready" : "pending",
      error_message: null,
    }).eq("id", taskId);

    return new Response(JSON.stringify({ ok: true, overall, issues: parsed.issues?.length ?? 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("deep-video-review error:", msg);
    if (taskId) {
      try { await supabase.from("qc_tasks").update({ status: "failed", transcript_status: "failed", error_message: msg }).eq("id", taskId); } catch {}
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
