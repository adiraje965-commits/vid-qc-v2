import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SEVERITY_WEIGHTS: Record<string, number> = { critical: 25, high: 15, medium: 8, low: 3 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { taskId } = await req.json();
    if (!taskId) return new Response(JSON.stringify({ error: "taskId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: task } = await supabase.from("qc_tasks").select("technical_score,brand_score,strategic_score,contextual_score").eq("id", taskId).maybeSingle();
    const { data: issues } = await supabase.from("qc_issues").select("bucket,severity").eq("task_id", taskId);
    const list = issues ?? [];

    const counts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
    const penalty: Record<string, number> = { technical: 0, brand: 0, strategic: 0, contextual: 0 };
    for (const i of list) {
      counts[i.severity] = (counts[i.severity] ?? 0) + 1;
      penalty[i.bucket] = (penalty[i.bucket] ?? 0) + (SEVERITY_WEIGHTS[i.severity] ?? 0);
    }

    const base = {
      technical: task?.technical_score ?? 75,
      brand: task?.brand_score ?? 75,
      strategic: task?.strategic_score ?? 75,
      contextual: task?.contextual_score ?? 75,
    };
    const adj = {
      technical: Math.max(0, base.technical - Math.min(40, penalty.technical * 0.4)),
      brand: Math.max(0, base.brand - Math.min(40, penalty.brand * 0.4)),
      strategic: Math.max(0, base.strategic - Math.min(40, penalty.strategic * 0.4)),
      contextual: Math.max(0, base.contextual - Math.min(40, penalty.contextual * 0.4)),
    };
    const overall = Math.round(adj.technical * 0.25 + adj.brand * 0.30 + adj.strategic * 0.20 + adj.contextual * 0.25);

    await supabase.from("qc_tasks").update({
      status: "completed",
      transcript_status: "ready",
      technical_score: Math.round(adj.technical),
      brand_score: Math.round(adj.brand),
      strategic_score: Math.round(adj.strategic),
      contextual_score: Math.round(adj.contextual),
      overall_score: overall,
      critical_count: counts.critical,
      high_count: counts.high,
      medium_count: counts.medium,
      low_count: counts.low,
    }).eq("id", taskId);

    return new Response(JSON.stringify({ ok: true, overall, counts }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
