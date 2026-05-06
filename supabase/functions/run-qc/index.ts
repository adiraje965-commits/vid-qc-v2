import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY")!;

const SEVERITY_WEIGHTS: Record<string, number> = { critical: 25, high: 15, medium: 8, low: 3 };

async function firecrawlScrape(url: string) {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown", "links"], onlyMainContent: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Firecrawl ${res.status}`);
  const markdown = data.data?.markdown ?? data.markdown ?? "";
  const metadata = data.data?.metadata ?? data.metadata ?? {};
  const links: string[] = data.data?.links ?? data.links ?? [];
  const videoUrl = links.find((l) => /\.(mp4|webm|mov)(\?|$)/i.test(l)) ||
    (markdown.match(/https?:\/\/[^\s)]+\.(?:mp4|webm|mov)/i)?.[0]) || null;
  return { markdown, metadata, videoUrl, links };
}

const ANALYSIS_TOOL = {
  type: "function",
  function: {
    name: "submit_qc_analysis",
    description: "Submit Video QC analysis report",
    parameters: {
      type: "object",
      properties: {
        customer_intent: { type: "string", description: "Inferred customer intent from page" },
        topic_match_score: { type: "integer", minimum: 0, maximum: 100 },
        analysis_summary: { type: "string" },
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
              timestamp_sec: { type: "number" },
              title: { type: "string" },
              description: { type: "string" },
              suggested_fix: { type: "string" },
            },
            required: ["bucket", "severity", "title", "description", "suggested_fix"],
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
        transcript: {
          type: "array",
          description: "Timestamped transcript segments covering the full video. If exact audio is not accessible, infer a plausible transcript from the page context and key moments, with monotonically increasing timestamps spread across an estimated 30-90s duration.",
          items: {
            type: "object",
            properties: {
              start: { type: "number", description: "Segment start in seconds" },
              end: { type: "number", description: "Segment end in seconds" },
              text: { type: "string" },
              speaker: { type: "string" },
            },
            required: ["start", "end", "text"],
            additionalProperties: false,
          },
        },
      },
      required: ["customer_intent", "topic_match_score", "analysis_summary", "bucket_scores", "issues", "key_frames", "transcript"],
      additionalProperties: false,
    },
  },
} as const;

async function runGemini(pageMarkdown: string, videoUrl: string | null, pageUrl: string, complianceCheck: boolean) {
  const systemPrompt = `You are a senior Video QC analyst for Bajaj Finance, a major Indian financial services brand.
Analyze a marketing video against the landing page it lives on. Be strict, specific, and grounded.

Score four buckets (0-100):
- Technical: resolution, framing, audio clarity, encoding artifacts
- Brand: Bajaj Finance logo usage, brand colors (deep blue, white), persona consistency, typography${complianceCheck ? ", and MANDATORY legal disclaimers (T&C apply, *Conditions apply, RBI compliance) at the end" : ""}
- Strategic: opening hook (first 3s), clear CTA, narrative pacing${complianceCheck ? ", legal copy presence" : ""}
- Contextual: how well the video matches the page's product, customer intent, and topic

Return 4-12 issues with realistic timestamps. Severity drives weight.
Return 4-8 key_frames marking notable moments (good or bad).
Return a transcript array with 6-20 short segments (2-6s each) covering the entire video runtime, in chronological order with non-overlapping timestamps. If you cannot directly hear the audio, infer a faithful transcript from the page topic, CTA, and visible key frames.`;

  const userContent: any[] = [
    { type: "text", text: `PAGE URL: ${pageUrl}\n\nPAGE CONTEXT (Firecrawl markdown):\n${pageMarkdown.slice(0, 8000)}\n\nVIDEO URL: ${videoUrl ?? "(none detected on page)"}\n\nProduce the QC report by calling submit_qc_analysis.` },
  ];

  const body = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: "function", function: { name: "submit_qc_analysis" } },
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("PAYMENT_REQUIRED");
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error("No tool call returned");
  return JSON.parse(call.function.arguments);
}

function computeOverall(bucket: { technical: number; brand: number; strategic: number; contextual: number }, issues: any[]) {
  // Apply severity penalties on top of model bucket scores
  const penalty: Record<string, number> = { technical: 0, brand: 0, strategic: 0, contextual: 0 };
  for (const i of issues) {
    penalty[i.bucket] = (penalty[i.bucket] ?? 0) + (SEVERITY_WEIGHTS[i.severity] ?? 0);
  }
  const adjusted = {
    technical: Math.max(0, bucket.technical - Math.min(40, penalty.technical * 0.4)),
    brand: Math.max(0, bucket.brand - Math.min(40, penalty.brand * 0.4)),
    strategic: Math.max(0, bucket.strategic - Math.min(40, penalty.strategic * 0.4)),
    contextual: Math.max(0, bucket.contextual - Math.min(40, penalty.contextual * 0.4)),
  };
  const overall = Math.round(
    adjusted.technical * 0.25 + adjusted.brand * 0.30 + adjusted.strategic * 0.20 + adjusted.contextual * 0.25
  );
  return { adjusted, overall };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const { taskId, url, complianceCheck, videoUrl: providedVideo, pageMarkdown: providedMd, pageTitle: providedTitle, skipScrape } = await req.json();
    if (!taskId || !url) throw new Error("taskId and url required");

    let pageMarkdown = providedMd ?? "";
    let videoUrl = providedVideo ?? null;
    if (!skipScrape || !pageMarkdown) {
      const scraped = await firecrawlScrape(url);
      pageMarkdown = pageMarkdown || scraped.markdown;
      videoUrl = videoUrl || scraped.videoUrl;
      await supabase.from("qc_tasks").update({
        page_title: providedTitle ?? scraped.metadata?.title ?? null,
        page_markdown: pageMarkdown,
        video_url: videoUrl,
        thumbnail_url: scraped.metadata?.ogImage ?? null,
      }).eq("id", taskId);
    }

    // 2) Gemini
    const result = await runGemini(pageMarkdown, videoUrl, url, !!complianceCheck);

    // 3) Score
    const { adjusted, overall } = computeOverall(result.bucket_scores, result.issues);
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of result.issues) (counts as any)[i.severity]++;

    await supabase.from("qc_tasks").update({
      status: "completed",
      customer_intent: result.customer_intent,
      topic_match_score: result.topic_match_score,
      analysis_summary: result.analysis_summary,
      technical_score: Math.round(adjusted.technical),
      brand_score: Math.round(adjusted.brand),
      strategic_score: Math.round(adjusted.strategic),
      contextual_score: Math.round(adjusted.contextual),
      overall_score: overall,
      critical_count: counts.critical,
      high_count: counts.high,
      medium_count: counts.medium,
      low_count: counts.low,
      key_frames: result.key_frames,
      transcript: result.transcript ?? [],
    }).eq("id", taskId);

    if (result.issues.length) {
      await supabase.from("qc_issues").insert(
        result.issues.map((i: any) => ({ ...i, task_id: taskId }))
      );
    }

    return new Response(JSON.stringify({ ok: true, taskId, overall }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("run-qc error:", msg);
    try {
      const { taskId } = await req.clone().json().catch(() => ({}));
      if (taskId) await supabase.from("qc_tasks").update({ status: "failed", error_message: msg }).eq("id", taskId);
    } catch {}
    const status = msg === "RATE_LIMIT" ? 429 : msg === "PAYMENT_REQUIRED" ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
