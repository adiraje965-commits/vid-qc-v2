// list-playbook-assets: paginated + searchable lister for a public Playbook board.
// Used by Pre-live's asset picker so boards with thousands of videos remain usable.

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const PB_COLLECTION_ASSETS_OP_ID = "graphql-frontend-prod/02aafb123aa4f9ad468834c746542cb1";
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const PB_RESERVED = new Set([
  "s", "api", "graphql", "assets", "static", "auth", "login", "logout",
  "signup", "signin", "_next", "favicon.ico", "settings", "pricing",
  "about", "help", "privacy", "terms", "contact", "blog", "download",
  "discover", "explore",
]);

type Ctx = { org: string; sharedLinkSlug: string };

function parseUrl(input: string): Ctx | null {
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  if (!/(^|\.)playbook\.com$/i.test(u.hostname)) return null;
  let m = u.pathname.match(/^\/s\/([^\/]+)\/([^\/?#]+)/);
  if (!m) {
    const bare = u.pathname.match(/^\/([^\/]+)\/([^\/?#]+)/);
    if (bare && !PB_RESERVED.has(bare[1].toLowerCase())) m = bare;
  }
  if (!m) return null;
  return { org: m[1], sharedLinkSlug: m[2] };
}

async function gql(ctx: Ctx, opName: string, opId: string, variables: Record<string, unknown>) {
  const url = new URL("https://www.playbook.com/graphql");
  url.searchParams.set("operationName", opName);
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set("extensions", JSON.stringify({ operationId: opId }));
  const res = await fetch(url.toString(), {
    headers: {
      organization: ctx.org,
      sharedlinkslug: ctx.sharedLinkSlug,
      clienttype: "web-app",
      accept: "*/*",
      "User-Agent": BROWSER_HEADERS["User-Agent"],
    },
  });
  if (!res.ok) throw new Error(`Playbook GraphQL ${opName} ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Playbook GraphQL: ${json.errors[0]?.message ?? "error"}`);
  return json.data;
}

function extractCollectionToken(html: string): string | null {
  // Primary: server-rendered attribute
  let m = html.match(/data-collection-token=["']([^"']+)["']/);
  if (m) return m[1];
  // Fallback 1: escaped JSON inside <script> (Next.js/Apollo cache)
  m = html.match(/collectionToken\\["']?:\\?["']([A-Za-z0-9_-]{8,})\\?["']/);
  if (m) return m[1];
  // Fallback 2: plain JSON
  m = html.match(/"collectionToken"\s*:\s*"([A-Za-z0-9_-]{8,})"/);
  if (m) return m[1];
  // Fallback 3: query-style serialization
  m = html.match(/collectionToken=([A-Za-z0-9_-]{8,})/);
  if (m) return m[1];
  return null;
}

async function resolveCollectionToken(ctx: Ctx): Promise<string | null> {
  // Try both URL shapes — some boards only render at /<org>/<slug>, others at /s/<org>/<slug>.
  // /s/ shape tends to be heaviest and most reliably contains data-collection-token.
  const candidates = [
    `https://www.playbook.com/s/${ctx.org}/${ctx.sharedLinkSlug}`,
    `https://www.playbook.com/${ctx.org}/${ctx.sharedLinkSlug}`,
  ];
  for (const u of candidates) {
    try {
      const res = await fetch(u, { headers: BROWSER_HEADERS, redirect: "follow" });
      if (!res.ok) {
        console.warn("[list-playbook-assets] fetch non-ok", u, res.status);
        continue;
      }
      const html = await res.text();
      const tok = extractCollectionToken(html);
      if (tok) return tok;
      console.warn("[list-playbook-assets] no token found in", u, "len=", html.length);
    } catch (e) {
      console.warn("[list-playbook-assets] fetch error", u, e instanceof Error ? e.message : String(e));
    }
  }
  return null;
}

function summary(a: any) {
  const thumb = a?.safeThumbnail?.url
    ?? (Array.isArray(a?.thumbnails) ? a.thumbnails[0]?.url : null)
    ?? null;
  return {
    token: a?.token as string,
    title: (a?.title as string) ?? null,
    duration: typeof a?.duration === "number" ? a.duration : null,
    mediaType: (a?.mediaType as string) ?? null,
    thumbnail: thumb as string | null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const url: string = body?.url ?? "";
    const cursor: string | null = body?.cursor ?? null;
    const query: string = (body?.query ?? "").toString().trim();
    const pageSize: number = Math.max(1, Math.min(100, Number(body?.pageSize) || 50));

    const ctx = parseUrl(url);
    if (!ctx) {
      return new Response(JSON.stringify({ ok: false, error: "Not a Playbook board URL." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const collectionToken = await resolveCollectionToken(ctx);
    if (!collectionToken) {
      return new Response(JSON.stringify({ ok: false, error: "Couldn't read the Playbook board (private or invalid link)." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const variables: Record<string, unknown> = {
      collectionToken,
      filters: query ? { search: query } : {},
      includeSubboards: false,
      sortBySubboards: true,
      first: pageSize,
      discarded: false,
      includeGroups: false,
      incompleteOnly: false,
    };
    if (cursor) variables.after = cursor;

    const data = await gql(ctx, "CollectionAssetsQuery", PB_COLLECTION_ASSETS_OP_ID, variables);
    const cursorObj = data?.collection?.assetsCursor ?? {};
    const edges: any[] = cursorObj.edges ?? [];
    const pageInfo = cursorObj.pageInfo ?? {};
    const all = edges.map((e) => e?.node).filter(Boolean);
    let videos = all.filter((n) => typeof n.mediaType === "string" && n.mediaType.startsWith("video/"));
    // Client-side title fallback filter (in case Playbook's `filters.search` isn't honored)
    if (query) {
      const q = query.toLowerCase();
      const filtered = videos.filter((n) => (n.title ?? "").toLowerCase().includes(q));
      // If server already filtered (filtered count == videos count or close), keep videos as-is.
      if (filtered.length < videos.length) videos = filtered;
    }
    const assets = videos.map(summary);

    return new Response(JSON.stringify({
      ok: true,
      assets,
      nextCursor: pageInfo.endCursor ?? null,
      hasMore: !!pageInfo.hasNextPage,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
