import { useState, KeyboardEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X, Tag as TagIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export function TagsEditor({ taskId, tags, onChange }: { taskId: string; tags: string[]; onChange?: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");

  async function save(next: string[]) {
    const { error } = await supabase.from("qc_tasks").update({ tags: next }).eq("id", taskId);
    if (error) toast({ title: "Tag update failed", description: error.message, variant: "destructive" });
    else onChange?.(next);
  }

  function add() {
    const t = draft.trim().toLowerCase();
    if (!t || tags.includes(t)) { setDraft(""); return; }
    save([...tags, t]); setDraft("");
  }
  function remove(t: string) { save(tags.filter((x) => x !== t)); }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
      {tags.map((t) => (
        <Badge key={t} variant="outline" className="gap-1 border-primary/30 bg-primary/10 text-primary">
          {t}
          <button onClick={() => remove(t)} className="hover:text-foreground"><X className="h-3 w-3" /></button>
        </Badge>
      ))}
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add} placeholder="add tag…" className="h-6 w-24 border-dashed text-xs" />
    </div>
  );
}
