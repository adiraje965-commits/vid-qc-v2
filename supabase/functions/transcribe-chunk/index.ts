import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;

interface Word { text: string; start: number; end: number; speaker_id?: string }
interface Segment { start: number; end: number; text: string; speaker?: string }

function groupWords(words: Word[]): Segment[] {
  const out: Segment[] = [];
  let cur: { start: number; end: number; parts: string[]; speaker?: string } | null = null;
  for (const w of words) {
    if (!w.text) continue;
    if (!cur) cur = { start: w.start, end: w.end, parts: [w.text], speaker: w.speaker_id };
    else if ((w.start - cur.end) > 0.8 || cur.parts.length > 18) {
      out.push({ start: cur.start, end: cur.end, text: cur.parts.join(" ").trim(), speaker: cur.speaker });
      cur = { start: w.start, end: w.end, parts: [w.text], speaker: w.speaker_id };
    } else { cur.end = w.end; cur.parts.push(w.text); }
  }
  if (cur) out.push({ start: cur.start, end: cur.end, text: cur.parts.join(" ").trim(), speaker: cur.speaker });
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const form = await req.formData();
    const taskId = String(form.get("taskId") ?? "");
    const startSec = parseFloat(String(form.get("startSec") ?? "0")) || 0;
    const audio = form.get("audio");
    if (!taskId || !(audio instanceof File || audio instanceof Blob)) {
      return new Response(JSON.stringify({ error: "taskId and audio required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const apiForm = new FormData();
    const file = audio instanceof File ? audio : new File([audio], "chunk.webm", { type: "audio/webm" });
    apiForm.append("file", file);
    apiForm.append("model_id", "scribe_v1");
    apiForm.append("timestamps_granularity", "word");
    apiForm.append("diarize", "true");

    const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST", headers: { "xi-api-key": ELEVENLABS_API_KEY }, body: apiForm,
    });
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: `ElevenLabs ${r.status}: ${t.slice(0, 300)}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await r.json();
    const words: Word[] = data.words ?? [];
    let segments = words.length ? groupWords(words) : (data.text ? [{ start: 0, end: 0, text: data.text }] : []);
    segments = segments.map((s) => ({ ...s, start: s.start + startSec, end: s.end + startSec }));

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: task } = await supabase.from("qc_tasks").select("transcript").eq("id", taskId).maybeSingle();
    const existing = ((task?.transcript ?? []) as Segment[]) || [];
    const merged = [...existing, ...segments].sort((a, b) => a.start - b.start);
    await supabase.from("qc_tasks").update({ transcript: merged as any, transcript_status: "pending" }).eq("id", taskId);

    return new Response(JSON.stringify({ ok: true, appended: segments.length, total: merged.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("transcribe-chunk error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
