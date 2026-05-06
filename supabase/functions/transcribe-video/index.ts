import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

interface Word { text: string; start: number; end: number; speaker_id?: string; type?: string }
interface Segment { start: number; end: number; text: string; speaker?: string }

type ResolvedMedia =
  | { kind: "mp4"; url: string }
  | { kind: "hls"; url: string }
  | { kind: "none"; reason: string };

function isKnownUnsupported(url: string | null): boolean {
  if (!url) return true;
  if (/youtube\.com|youtu\.be/i.test(url)) return true;
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

function findMediaInHtml(html: string, baseUrl: string): { kind: "mp4" | "hls"; url: string } | null {
  // og:video / og:audio meta
  const ogVideo = html.match(/<meta[^>]+property=["']og:(?:video|audio)(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i);
  if (ogVideo?.[1]) {
    const u = absolutize(baseUrl, ogVideo[1]);
    const k = classifyByExt(u);
    if (k) return { kind: k, url: u };
  }
  // <video src> or <source src>
  const sourceTag = html.match(/<(?:source|video)[^>]+src=["']([^"']+\.(?:mp4|m3u8|m4a|webm|wav|mp3))["']/i);
  if (sourceTag?.[1]) {
    const u = absolutize(baseUrl, sourceTag[1]);
    const k = classifyByExt(u);
    if (k) return { kind: k, url: u };
  }
  // JSON-LD VideoObject contentUrl
  const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of jsonLdMatches) {
    try {
      const j = JSON.parse(m[1]);
      const arr = Array.isArray(j) ? j : [j];
      for (const node of arr) {
        const cu = node?.contentUrl ?? node?.video?.contentUrl;
        if (typeof cu === "string") {
          const u = absolutize(baseUrl, cu);
          const k = classifyByExt(u);
          if (k) return { kind: k, url: u };
        }
      }
    } catch { /* ignore */ }
  }
  // Generic regex: prefer mp4 over m3u8 so STT works
  const mp4 = html.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|m4a|webm|wav|mp3)(?:\?[^\s"'<>]*)?/i);
  if (mp4?.[0]) return { kind: "mp4", url: mp4[0] };
  const hls = html.match(/https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?/i);
  if (hls?.[0]) return { kind: "hls", url: hls[0] };
  // Iframe src — return so caller can recurse one level
  const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframe?.[1]) {
    const u = absolutize(baseUrl, iframe[1]);
    return { kind: "mp4", url: `__iframe__:${u}` }; // sentinel, caller detects
  }
  return null;
}

async function resolveMediaUrl(input: string, depth = 0): Promise<ResolvedMedia> {
  if (depth > 1) return { kind: "none", reason: "Too many redirects through embed iframes." };
  if (isKnownUnsupported(input)) {
    return { kind: "none", reason: "YouTube/Vimeo embeds are not supported for transcription." };
  }

  // Quick win: extension says it's already media.
  const byExt = classifyByExt(input);
  if (byExt) return { kind: byExt, url: input };

  // Probe headers
  let res: Response;
  try {
    res = await fetch(input, { method: "GET", headers: BROWSER_HEADERS, redirect: "follow" });
  } catch (e) {
    return { kind: "none", reason: `Failed to fetch source: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) {
    return { kind: "none", reason: `Source returned ${res.status} ${res.statusText}` };
  }
  const ct = res.headers.get("content-type") ?? "";
  const byCt = classifyByContentType(ct);
  if (byCt) {
    // It's media we can use directly. Discard body (we'll re-download in transcribe).
    await res.body?.cancel();
    return { kind: byCt, url: res.url };
  }

  // It's HTML (or similar). Parse for media.
  const html = await res.text();
  const found = findMediaInHtml(html, res.url);
  if (!found) return { kind: "none", reason: "No direct media file found inside the page." };

  if (found.url.startsWith("__iframe__:")) {
    return resolveMediaUrl(found.url.slice("__iframe__:".length), depth + 1);
  }
  return { kind: found.kind, url: found.url };
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

async function transcribeMp4WithElevenLabs(mediaUrl: string): Promise<Segment[]> {
  const mediaRes = await fetch(mediaUrl, { headers: BROWSER_HEADERS, redirect: "follow" });
  if (!mediaRes.ok) throw new Error(`Failed to download media (${mediaRes.status})`);
  const ct = mediaRes.headers.get("content-type") ?? "video/mp4";
  if (!classifyByContentType(ct)) {
    throw new Error(`Resolved URL did not return media (content-type: ${ct})`);
  }
  const blob = await mediaRes.blob();
  const form = new FormData();
  form.append("file", new File([blob], "video.mp4", { type: ct }));
  form.append("model_id", "scribe_v1");
  form.append("diarize", "true");
  form.append("timestamps_granularity", "word");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
    body: form,
  });
  if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const words: Word[] = data.words ?? [];
  if (!words.length && data.text) return [{ start: 0, end: 0, text: data.text }];
  return groupWords(words);
}

async function transcribeHlsWithGemini(hlsUrl: string): Promise<Segment[]> {
  // Gemini can ingest remote media via fileData; tell it to return diarized timestamped transcript.
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
                start: { type: "number", description: "Start time in seconds" },
                end: { type: "number", description: "End time in seconds" },
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
          "You are a transcription engine. Listen to the provided video/audio and return an accurate, diarized transcript with realistic timestamps in seconds. Break into ~3-6 second segments at natural pauses or speaker changes. Do not invent content — transcribe only what is actually spoken.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this video by calling submit_transcript." },
          // OpenAI-compatible image_url field also supports media URLs through the gateway.
          { type: "image_url", image_url: { url: hlsUrl } },
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

    // Persist what we resolved so the UI can show it and re-runs are cheap.
    await supabase.from("qc_tasks").update({
      media_url: resolved.url,
      media_kind: resolved.kind,
    }).eq("id", taskId);

    const segments = resolved.kind === "mp4"
      ? await transcribeMp4WithElevenLabs(resolved.url)
      : await transcribeHlsWithGemini(resolved.url);

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
