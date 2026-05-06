import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageCircle, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Comment { id: string; task_id: string; user_id: string; body: string; timestamp_sec: number | null; created_at: string }
interface ProfileLite { id: string; display_name: string | null; email: string | null; avatar_url: string | null }

export function CommentsPanel({ taskId, currentTime, onSeek }: { taskId: string; currentTime: number; onSeek?: (t: number) => void }) {
  const { user, isAdmin } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [body, setBody] = useState("");
  const [withTimestamp, setWithTimestamp] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    async function load() {
      const { data } = await supabase.from("qc_comments").select("*").eq("task_id", taskId).order("created_at", { ascending: true });
      if (cancel) return;
      const list = (data ?? []) as Comment[];
      setComments(list);
      const ids = Array.from(new Set(list.map((c) => c.user_id)));
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select("id,display_name,email,avatar_url").in("id", ids);
        if (!cancel) setProfiles(Object.fromEntries(((ps ?? []) as ProfileLite[]).map((p) => [p.id, p])));
      }
    }
    load();
    const ch = supabase.channel(`comments_${taskId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "qc_comments", filter: `task_id=eq.${taskId}` }, () => load())
      .subscribe();
    return () => { cancel = true; supabase.removeChannel(ch); };
  }, [taskId]);

  async function add() {
    if (!user || !body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("qc_comments").insert({
      task_id: taskId, user_id: user.id, body: body.trim(),
      timestamp_sec: withTimestamp ? Math.round(currentTime) : null,
    });
    setBusy(false);
    if (error) toast({ title: "Failed to post", description: error.message, variant: "destructive" });
    else setBody("");
  }

  async function remove(id: string) {
    const { error } = await supabase.from("qc_comments").delete().eq("id", id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
  }

  return (
    <div className="surface-card p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium"><MessageCircle className="h-4 w-4 text-primary" /> Reviewer Comments <span className="text-xs text-muted-foreground">({comments.length})</span></div>
      <div className="mb-3 max-h-64 space-y-2 overflow-y-auto">
        {comments.length === 0 && <div className="text-xs text-muted-foreground">No comments yet. Be the first.</div>}
        {comments.map((c) => {
          const p = profiles[c.user_id];
          const name = p?.display_name || p?.email || "Reviewer";
          const canDelete = user?.id === c.user_id || isAdmin;
          return (
            <div key={c.id} className="rounded-md border border-border bg-card/40 p-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium">{name}</span>
                <div className="flex items-center gap-2 text-muted-foreground">
                  {c.timestamp_sec != null && (
                    <button onClick={() => onSeek?.(c.timestamp_sec ?? 0)} className="text-primary hover:underline">@{Math.round(c.timestamp_sec)}s</button>
                  )}
                  <span>{new Date(c.created_at).toLocaleString()}</span>
                  {canDelete && <button onClick={() => remove(c.id)} className="text-muted-foreground hover:text-severity-critical"><Trash2 className="h-3 w-3" /></button>}
                </div>
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm">{c.body}</div>
            </div>
          );
        })}
      </div>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" rows={2} />
      <div className="mt-2 flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={withTimestamp} onChange={(e) => setWithTimestamp(e.target.checked)} />
          Pin to current time ({Math.round(currentTime)}s)
        </label>
        <Button size="sm" onClick={add} disabled={busy || !body.trim()}>{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Post"}</Button>
      </div>
    </div>
  );
}
