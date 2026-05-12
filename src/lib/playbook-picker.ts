import { supabase } from "@/integrations/supabase/client";

export type PbAsset = {
  token: string;
  title: string | null;
  duration: number | null;
  mediaType: string | null;
  thumbnail: string | null;
};

export type PbListResponse = {
  ok: boolean;
  assets?: PbAsset[];
  nextCursor?: string | null;
  hasMore?: boolean;
  error?: string;
};

export async function listPlaybookAssets(input: {
  url: string;
  cursor?: string | null;
  query?: string;
  pageSize?: number;
}): Promise<PbListResponse> {
  const { data, error } = await supabase.functions.invoke("list-playbook-assets", {
    body: {
      url: input.url,
      cursor: input.cursor ?? null,
      query: input.query ?? "",
      pageSize: input.pageSize ?? 50,
    },
  });
  if (error) return { ok: false, error: error.message };
  return data as PbListResponse;
}
