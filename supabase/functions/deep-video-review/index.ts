// deep-video-review: REAL video QC using Google AI Files API.
// Supports videos up to ~2GB / 1hr. Server-side downloads the video,
// uploads to Google's File API (resumable), polls until ACTIVE, then
// asks Gemini 2.5 Pro to actually watch it (visuals + audio + supers).

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY")!;

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

    // 1) Download video bytes
    console.log("Downloading video:", videoUrl);
    const vRes = await fetch(videoUrl, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 LovableQC/1.0", Accept: "video/*,*/*" } });
    if (!vRes.ok) throw new Error(`Could not fetch video (${vRes.status}). Host may block server-side downloads — try Live Capture.`);
    let ct = (vRes.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const urlExt = videoUrl.split("?")[0].split("#")[0].toLowerCase();
    const looksLikeVideoUrl = /\.(mp4|webm|mov|m4v|mkv)$/.test(urlExt);
    if (!ct || ct === "application/octet-stream" || /^binary\//.test(ct)) {
      ct = looksLikeVideoUrl ? (urlExt.endsWith(".webm") ? "video/webm" : "video/mp4") : ct || "video/mp4";
    }
    if (!/^video\//i.test(ct)) {
      throw new Error(`URL returned ${ct || "unknown content-type"} (not a video). The link is probably a webpage/iframe player, not a direct file. Right-click the actual video and copy its direct .mp4/.webm URL, or use Live Capture for embedded players.`);
    }
    const buf = new Uint8Array(await vRes.arrayBuffer());
    console.log(`Downloaded ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB`);

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
      try { await supabase.from("qc_tasks").update({ error_message: msg }).eq("id", taskId); } catch {}
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
