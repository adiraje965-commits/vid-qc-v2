import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;

interface Word { text: string; start: number; end: number; speaker_id?: string; type?: string }
interface Segment { start: number; end: number; text: string; speaker?: string }

function isUnsupportedSource(url: string | null): boolean {
  if (!url) return true;
  if (/youtube\.com|youtu\.be/i.test(url)) return true;
  if (/vimeo\.com/i.test(url)) return true;
  // Embed/player pages return HTML, not media — STT can't process them.
  if (/\/embed(ded)?(\/|\?|$)/i.test(url)) return true;
  if (/player\./i.test(url)) return true;
  return false;
}

function isMediaContentType(ct: string): boolean {
  const t = ct.toLowerCase();
  return t.startsWith("audio/") || t.startsWith("video/") || t === "application/octet-stream";
}

function groupWords(words: Word[]): Segment[] {
  const segs: Segment[] = [];
  let cur: { start: number; end: number; texts: string[]; speaker?: string } | null = null;
  const MAX_DUR = 5; // seconds per segment
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
    const wouldBeTooLong = (w.end - cur.start) > MAX_DUR;
    const speakerChange = speaker && cur.speaker && speaker !== cur.speaker;
    const endsSentence = /[.!?]$/.test(cur.texts.join("").trim()) && (w.end - cur.start) > 1.5;
    if (wouldBeTooLong || speakerChange || endsSentence) {
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

async function transcribeWithElevenLabs(videoUrl: string): Promise<Segment[] | { unsupported: true }> {
  // Download the media; ElevenLabs STT expects a multipart file upload.
  const mediaRes = await fetch(videoUrl, { redirect: "follow" });
  if (!mediaRes.ok) throw new Error(`Failed to download video (${mediaRes.status})`);
  const contentType = mediaRes.headers.get("content-type") ?? "";
  if (!isMediaContentType(contentType)) {
    // Got HTML (embed page) or other non-media — can't transcribe.
    return { unsupported: true };
  }
  const blob = await mediaRes.blob();

  const form = new FormData();
  form.append("file", new File([blob], "video.mp4", { type: contentType }));
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
  if (!words.length && data.text) {
    // No word-level data: produce a single segment.
    return [{ start: 0, end: 0, text: data.text }];
  }
  return groupWords(words);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  let taskId: string | undefined;
  try {
    const body = await req.json();
    taskId = body.taskId;
    const videoUrl: string | null = body.videoUrl ?? null;
    if (!taskId) throw new Error("taskId required");

    if (isUnsupportedSource(videoUrl)) {
      await supabase.from("qc_tasks").update({
        transcript: [],
        transcript_status: "unsupported_source",
      }).eq("id", taskId);
      return new Response(JSON.stringify({ ok: true, status: "unsupported_source" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("qc_tasks").update({ transcript_status: "pending" }).eq("id", taskId);

    const result = await transcribeWithElevenLabs(videoUrl as string);

    if ("unsupported" in result) {
      await supabase.from("qc_tasks").update({
        transcript: [],
        transcript_status: "unsupported_source",
      }).eq("id", taskId);
      return new Response(JSON.stringify({ ok: true, status: "unsupported_source" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("qc_tasks").update({
      transcript: result,
      transcript_status: "ready",
    }).eq("id", taskId);

    return new Response(JSON.stringify({ ok: true, count: result.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("transcribe-video error:", msg);
    if (taskId) {
      await supabase.from("qc_tasks").update({
        transcript_status: "failed",
        transcript: [],
      }).eq("id", taskId);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
