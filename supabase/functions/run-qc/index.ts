// run-qc: lightweight task initializer.
// NOTE: Generic Firecrawl/page-based QC has been REMOVED on user request.
// Real QC now comes from `deep-video-review` (native video understanding) and
// the browser-side `VideoCapture` flow. This function just marks the task ready
// for the user to trigger real video QC.

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const { taskId, videoUrl, pageMarkdown, pageTitle } = await req.json();
    if (!taskId) throw new Error("taskId required");

    await supabase.from("qc_tasks").update({
      status: "completed", // ready state — awaiting real video QC
      page_title: pageTitle ?? null,
      page_markdown: pageMarkdown ?? null,
      video_url: videoUrl ?? null,
      transcript_status: "pending",
      analysis_summary: "Awaiting real video QC. Click 'Deep Video Review' to analyze the actual video, or use Live Capture for in-browser frame+audio analysis.",
    }).eq("id", taskId);

    return new Response(JSON.stringify({ ok: true, taskId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("run-qc error:", msg);
    try {
      const { taskId } = await req.clone().json().catch(() => ({}));
      if (taskId) await supabase.from("qc_tasks").update({ status: "failed", error_message: msg }).eq("id", taskId);
    } catch {}
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
