import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export function ApprovalPanel({ taskId, status, note, ownerId }: { taskId: string; status: string; note: string | null; ownerId: string | null }) {
  const { user, isAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const canDecide = !!user && (isAdmin || user.id === ownerId);

  async function decide(next: "approved" | "rejected" | "pending") {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("qc_tasks").update({
      approval_status: next,
      approval_note: draft || null,
      approved_by: next === "pending" ? null : user.id,
      approved_at: next === "pending" ? null : new Date().toISOString(),
    }).eq("id", taskId);
    setBusy(false);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else toast({ title: `Marked ${next}` });
  }

  const tone = status === "approved" ? "border-score-good/40 text-score-good" : status === "rejected" ? "border-severity-critical/40 text-severity-critical" : "border-score-warn/40 text-score-warn";

  return (
    <div className="surface-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium">Sign-off</div>
        <Badge variant="outline" className={tone}>{status}</Badge>
      </div>
      {canDecide ? (
        <>
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="Optional note for approval/rejection" />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 border-score-good/40 text-score-good hover:bg-score-good/10" disabled={busy} onClick={() => decide("approved")}>
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}Approve
            </Button>
            <Button size="sm" variant="outline" className="flex-1 border-severity-critical/40 text-severity-critical hover:bg-severity-critical/10" disabled={busy} onClick={() => decide("rejected")}>
              <X className="mr-1 h-3 w-3" />Reject
            </Button>
            {status !== "pending" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("pending")}>Reset</Button>}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{note ?? "Awaiting reviewer decision."}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Only the task owner or an admin can change sign-off status.</p>
        </>
      )}
    </div>
  );
}
