// parse-brief-pdf: reads a PDF from the pre-live-briefs bucket via signed URL
// and asks Lovable AI (Gemini Flash) to extract structured campaign brief fields.

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM = `You extract campaign briefs for a video QC platform. Return ONLY valid JSON matching this schema:
{
  "campaign_name": string|null,
  "business_key": string|null,        // one of: personal-loan, two-wheeler-loan, new-car-loan, used-car-loan, consumer-durable-loan, business-loan, professional-loan, gold-loan, home-loan, loan-against-securities, tractor-finance, insurance, demat, mutual-fund, fd
  "persona": string|null,
  "channel": string|null,             // TV, YouTube pre-roll, Instagram Reel, Instagram Story, YouTube Bumper 6s, Web hero, Other
  "aspect_ratio": string|null,        // 16:9, 9:16, 1:1, 4:5
  "target_runtime_sec": number|null,
  "languages": string[],              // e.g. ["English","Hindi"]
  "key_claims": string[],
  "mandatory_disclaimers": string[],
  "notes": string|null
}
Use null/empty arrays when unsure. No prose.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { briefPdfPath } = await req.json();
    if (!briefPdfPath || typeof briefPdfPath !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "briefPdfPath required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: signed, error: signErr } = await supa.storage.from("pre-live-briefs").createSignedUrl(briefPdfPath, 600);
    if (signErr || !signed?.signedUrl) throw new Error(`Could not sign brief PDF: ${signErr?.message || "no url"}`);

    const pdfRes = await fetch(signed.signedUrl);
    if (!pdfRes.ok) throw new Error(`Could not download brief PDF (${pdfRes.status})`);
    const buf = new Uint8Array(await pdfRes.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);

    const ai = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the brief fields from this campaign brief PDF." },
              { type: "image_url", image_url: { url: `data:application/pdf;base64,${b64}` } },
            ],
          },
        ],
      }),
    });
    if (!ai.ok) {
      const t = await ai.text();
      throw new Error(`AI call failed (${ai.status}): ${t.slice(0, 300)}`);
    }
    const j = await ai.json();
    const text: string = j?.choices?.[0]?.message?.content ?? "";
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: any = {};
    try { parsed = JSON.parse(cleaned); } catch { parsed = {}; }

    return new Response(JSON.stringify({ ok: true, brief: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
