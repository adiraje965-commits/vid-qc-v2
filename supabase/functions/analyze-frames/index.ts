import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const TOOL = {
  type: "function",
  function: {
    name: "submit_frame_qc",
    description: "Visual QC findings for a batch of video frames",
    parameters: {
      type: "object",
      properties: {
        frame_observations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              timestamp_sec: { type: "number" },
              scene: { type: "string" },
              on_screen_text: { type: "array", items: { type: "string" }, description: "All visible text/supers/CTAs/disclaimers OCR'd from frame" },
            },
            required: ["timestamp_sec", "scene", "on_screen_text"],
            additionalProperties: false,
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
            additionalProperties: false,
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
            additionalProperties: false,
          },
        },
      },
      required: ["frame_observations", "issues", "key_frames"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { taskId, frames, transcriptWindow, pageContext } = await req.json();
    if (!taskId || !Array.isArray(frames) || !frames.length) {
      return new Response(JSON.stringify({ error: "taskId and frames required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userParts: any[] = [
      { type: "text", text: `You are doing visual QC on a Bajaj Finance marketing video. For EACH frame, OCR all on-screen text (supers, lower-thirds, CTAs, prices, disclaimers, RBI/T&C notices). Flag REAL issues you can see (broken framing, missing logo, illegible super, missing disclaimer, off-brand colors, etc). Use the actual timestamp of each frame.\n\nPAGE CONTEXT:\n${(pageContext ?? "").slice(0, 2000)}\n\nRECENT TRANSCRIPT:\n${(transcriptWindow ?? "").slice(0, 2000)}\n\nFrames (with timestamps):` },
    ];
    for (const f of frames) {
      userParts.push({ type: "text", text: `Frame @ ${f.tsSec}s` });
      userParts.push({ type: "image_url", image_url: { url: f.dataUrl } });
    }

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a strict senior Video QC analyst. Return calibrated findings only — no hallucinated issues." },
          { role: "user", content: userParts },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "submit_frame_qc" } },
      }),
    });
    if (r.status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (r.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: `Gemini ${r.status}: ${t.slice(0, 300)}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await r.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const parsed = JSON.parse(call.function.arguments);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    if (parsed.issues?.length) {
      await supabase.from("qc_issues").insert(parsed.issues.map((i: any) => ({ ...i, task_id: taskId })));
    }
    if (parsed.key_frames?.length) {
      const { data: task } = await supabase.from("qc_tasks").select("key_frames").eq("id", taskId).maybeSingle();
      const existing = (task?.key_frames as any[]) || [];
      await supabase.from("qc_tasks").update({ key_frames: [...existing, ...parsed.key_frames] as any }).eq("id", taskId);
    }
    return new Response(JSON.stringify({ ok: true, issues: parsed.issues?.length ?? 0, observations: parsed.frame_observations?.length ?? 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("analyze-frames error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
