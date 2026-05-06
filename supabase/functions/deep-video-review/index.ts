// deep-video-review: REAL video QC.
// Downloads the video server-side, sends raw bytes to Gemini 2.5 Pro via the
// Lovable AI Gateway as native video input (not sampled frames), and lets the
// model "watch" it like a human reviewer would — visuals, audio, pacing,
// supers, disclaimers, brand cues, all in one pass.

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB inline limit

const SEVERITY_WEIGHTS: Record<string, number> = { critical: 25, high: 15, medium: 8, low: 3 };

const TOOL = {
  type: "function",
  function: {
    name: "submit_video_qc",
    description: "Real Video QC report after watching the actual video end-to-end.",
    parameters: {
      type: "object",
      properties: {
        analysis_summary: { type: "string", description: "2-3 sentence honest take from a senior QC reviewer who just watched the video." },
        what_a_user_feels: { type: "string", description: "First-person, persona-style impression: what a real customer notices, gets confused by, trusts, or doubts." },
        customer_intent: { type: "string" },
        topic_match_score: { type: "integer", minimum: 0, maximum: 100 },
        bucket_scores: {
          type: "object",
          properties: {
            technical: { type: "integer", minimum: 0, maximum: 100 },
            brand: { type: "integer", minimum: 0, maximum: 100 },
            strategic: { type: "integer", minimum: 0, maximum: 100 },
            contextual: { type: "integer", minimum: 0, maximum: 100 },
          },
          required: ["technical", "brand", "strategic", "contextual"],
          additionalProperties: false,
        },
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              bucket: { type: "string", enum: ["technical", "brand", "strategic", "contextual"] },
              severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
              timestamp_sec: { type: "number", description: "Real timestamp in the video where the issue occurs." },
              title: { type: "string" },
              description: { type: "string", description: "Cite exactly what is on screen / heard at that moment." },
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
      required: ["analysis_summary", "what_a_user_feels", "customer_intent", "topic_match_score", "bucket_scores", "issues", "key_frames"],
      additionalProperties: false,
    },
  },
} as const;

function computeOverall(b: { technical: number; brand: number; strategic: number; contextual: number }, issues: any[]) {
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

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid call-stack blow-ups on large arrays
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let taskId: string | undefined;
  try {
    const body = await req.json();
    taskId = body.taskId;
    const { videoUrl, pageContext, persona } = body;
    if (!taskId || !videoUrl) throw new Error("taskId and videoUrl required");

    // 1) Download video bytes server-side
    const vRes = await fetch(videoUrl, { headers: { "User-Agent": "Mozilla/5.0 LovableQC/1.0", Accept: "*/*" } });
    if (!vRes.ok) throw new Error(`Could not fetch video (${vRes.status}). Host may block server-side downloads — try Live Capture instead.`);
    const ct = vRes.headers.get("content-type") || "video/mp4";
    if (!/^video\//i.test(ct)) throw new Error(`URL did not return a video (content-type: ${ct}). Use a direct .mp4/.webm URL.`);

    const buf = new Uint8Array(await vRes.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(`Video is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB — over the 20 MB inline limit. Use Live Capture for longer videos.`);
    }
    const mime = ct.split(";")[0].trim();
    const dataUrl = `data:${mime};base64,${bytesToBase64(buf)}`;

    // 2) Ask Gemini 2.5 Pro to actually watch the video
    const systemPrompt = `You are a senior Video QC reviewer for Bajaj Finance, a major Indian financial services brand. You are about to WATCH the actual video (you can see and hear it). Behave like a real human reviewer:

- Watch end-to-end. Note real timestamps for everything you flag.
- OCR every super, lower-third, CTA, price, EMI, T&C, RBI line, disclaimer.
- Listen to the voiceover. Flag voice/visual mismatches, unclear pronunciation, missing call-to-action, missing legal copy.
- Judge pacing: hook in first 3 seconds? Does the message land? Does the CTA arrive too late?
- Brand: Bajaj Finance logo present? Brand colors (deep blue / white)? Persona consistent?
- Be strict. Do NOT invent issues. Only flag what you actually see or hear.

Score buckets 0-100: Technical (resolution, framing, audio clarity, encoding), Brand (logo, colors, typography, legal disclaimers), Strategic (hook, CTA, pacing, narrative), Contextual (matches the landing page intent and product).

Return 4-12 grounded issues with REAL timestamps. Return 4-8 key_frames.`;

    const userText = `${persona ? `PERSONA: ${persona}\n\n` : ""}LANDING PAGE CONTEXT:\n${(pageContext ?? "").slice(0, 4000)}\n\nWatch the attached video and call submit_video_qc with your honest review.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "submit_video_qc" } },
      }),
    });

    if (aiRes.status === 429) throw new Error("Rate limited by AI gateway. Try again in a minute.");
    if (aiRes.status === 402) throw new Error("AI credits exhausted. Top up at Settings > Workspace > Usage.");
    if (!aiRes.ok) {
      const t = await aiRes.text();
      throw new Error(`Gemini ${aiRes.status}: ${t.slice(0, 400)}`);
    }
    const data = await aiRes.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error("Model returned no QC report. Video may not be supported.");
    const parsed = JSON.parse(call.function.arguments);

    // 3) Persist — replace prior issues so dashboard reflects REAL findings
    await supabase.from("qc_issues").delete().eq("task_id", taskId);
    if (parsed.issues?.length) {
      await supabase.from("qc_issues").insert(parsed.issues.map((i: any) => ({ ...i, task_id: taskId })));
    }

    const { adjusted, overall } = computeOverall(parsed.bucket_scores, parsed.issues || []);
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of parsed.issues || []) (counts as any)[i.severity]++;

    const summary = `${parsed.analysis_summary}\n\nWhat a user feels: ${parsed.what_a_user_feels}`;

    await supabase.from("qc_tasks").update({
      status: "completed",
      customer_intent: parsed.customer_intent,
      topic_match_score: parsed.topic_match_score,
      analysis_summary: summary,
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
      error_message: null,
    }).eq("id", taskId);

    return new Response(JSON.stringify({ ok: true, overall, issues: parsed.issues?.length ?? 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("deep-video-review error:", msg);
    if (taskId) {
      try { await supabase.from("qc_tasks").update({ error_message: msg }).eq("id", taskId); } catch {}
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
