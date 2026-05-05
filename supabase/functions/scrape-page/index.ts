import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "url required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY missing");

    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown", "links"], onlyMainContent: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${JSON.stringify(data)}`);

    const markdown = data.data?.markdown ?? data.markdown ?? "";
    const metadata = data.data?.metadata ?? data.metadata ?? {};
    const links: string[] = data.data?.links ?? data.links ?? [];
    // Find a likely video URL
    const videoUrl = links.find((l) => /\.(mp4|webm|mov)(\?|$)/i.test(l)) ||
      (markdown.match(/https?:\/\/[^\s)]+\.(?:mp4|webm|mov)/i)?.[0]) || null;

    return new Response(JSON.stringify({ markdown, metadata, videoUrl, links: links.slice(0, 50) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scrape-page error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
