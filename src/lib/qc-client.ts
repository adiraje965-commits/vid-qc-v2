import { supabase } from "@/integrations/supabase/client";

export async function createTaskAndAnalyze(url: string, complianceCheck: boolean): Promise<string> {
  const { data, error } = await supabase
    .from("qc_tasks")
    .insert({ url, status: "processing" })
    .select("id")
    .single();
  if (error) throw error;
  const taskId = data.id;
  // fire-and-forget invocation; status is updated via realtime
  supabase.functions
    .invoke("run-qc", { body: { taskId, url, complianceCheck } })
    .catch((e) => console.error("run-qc invoke error", e));
  return taskId;
}

export async function bulkCreate(urls: string[], complianceCheck: boolean) {
  const ids: string[] = [];
  for (const url of urls) {
    try { ids.push(await createTaskAndAnalyze(url, complianceCheck)); } catch (e) { console.error(e); }
  }
  return ids;
}
