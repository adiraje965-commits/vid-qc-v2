import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, X } from "lucide-react";
import { ASPECT_OPTIONS, BUSINESS_OPTIONS, BriefDraft, CHANNEL_OPTIONS, LANGUAGE_OPTIONS } from "@/lib/prelive-types";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Props {
  value: BriefDraft;
  onChange: (b: BriefDraft) => void;
  briefPdfPath: string | null;
  onPdfPathChange: (p: string | null) => void;
  ownerId: string | null;
}

function ChipInput({ label, values, onChange, placeholder }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {values.map((v) => (
          <Badge key={v} variant="outline" className="gap-1 border-white/15">
            {v}
            <button onClick={() => onChange(values.filter((x) => x !== v))}><X className="h-3 w-3" /></button>
          </Badge>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder} className="h-8 text-xs" />
        <Button type="button" size="sm" variant="outline" onClick={add}>Add</Button>
      </div>
    </div>
  );
}

export function BriefForm({ value, onChange, briefPdfPath, onPdfPathChange, ownerId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);

  const handlePdf = async (file: File) => {
    if (!ownerId) { toast({ title: "Sign in first", variant: "destructive" }); return; }
    setParsing(true);
    try {
      const path = `${ownerId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("pre-live-briefs").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      onPdfPathChange(path);
      const { data, error } = await supabase.functions.invoke("parse-brief-pdf", { body: { briefPdfPath: path } });
      if (error) throw error;
      if ((data as any)?.ok && (data as any).brief) {
        const b = (data as any).brief;
        const businessKey = BUSINESS_OPTIONS.find((x) => x.key === b.business_key)?.key ?? value.business_key;
        const persona = b.persona || BUSINESS_OPTIONS.find((x) => x.key === businessKey)?.persona || value.persona;
        onChange({
          ...value,
          campaign_name: b.campaign_name || value.campaign_name,
          business_key: businessKey,
          persona,
          channel: b.channel || value.channel,
          aspect_ratio: b.aspect_ratio || value.aspect_ratio,
          target_runtime_sec: typeof b.target_runtime_sec === "number" ? b.target_runtime_sec : value.target_runtime_sec,
          languages: Array.isArray(b.languages) && b.languages.length ? b.languages : value.languages,
          key_claims: Array.isArray(b.key_claims) ? b.key_claims : value.key_claims,
          mandatory_disclaimers: Array.isArray(b.mandatory_disclaimers) ? b.mandatory_disclaimers : value.mandatory_disclaimers,
          notes: b.notes || value.notes,
        });
        toast({ title: "Brief auto-filled", description: "Review the extracted fields." });
      } else {
        toast({ title: "Could not auto-extract", description: (data as any)?.error || "Fill the form manually.", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Brief upload failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-white/15 bg-secondary/20 p-3">
        <div className="text-xs text-muted-foreground">
          {briefPdfPath ? <>Brief PDF: <span className="text-foreground">{briefPdfPath.split("/").pop()}</span></> : "Optional: upload brief PDF to auto-fill the fields below."}
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePdf(f); e.currentTarget.value = ""; }} />
          <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={parsing}>
            {parsing ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Parsing…</> : <><Upload className="mr-1 h-3 w-3" />Upload PDF</>}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Campaign name</label>
          <Input value={value.campaign_name} onChange={(e) => onChange({ ...value, campaign_name: e.target.value })} placeholder="e.g. Personal Loan Diwali 2026" className="mt-1 h-9" />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Business / Product</label>
          <Select value={value.business_key} onValueChange={(v) => {
            const persona = BUSINESS_OPTIONS.find((b) => b.key === v)?.persona ?? value.persona;
            onChange({ ...value, business_key: v, persona });
          }}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{BUSINESS_OPTIONS.map((b) => <SelectItem key={b.key} value={b.key}>{b.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Persona</label>
          <Input value={value.persona} onChange={(e) => onChange({ ...value, persona: e.target.value })} className="mt-1 h-9" />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Channel</label>
          <Select value={value.channel} onValueChange={(v) => onChange({ ...value, channel: v })}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{CHANNEL_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Aspect</label>
            <Select value={value.aspect_ratio} onValueChange={(v) => onChange({ ...value, aspect_ratio: v })}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{ASPECT_OPTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Runtime (s)</label>
            <Input type="number" value={value.target_runtime_sec ?? ""} onChange={(e) => onChange({ ...value, target_runtime_sec: e.target.value ? Number(e.target.value) : null })} className="mt-1 h-9" />
          </div>
        </div>
        <div className="md:col-span-2">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Languages</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {LANGUAGE_OPTIONS.map((l) => {
              const on = value.languages.includes(l);
              return (
                <button key={l} type="button" onClick={() => onChange({ ...value, languages: on ? value.languages.filter((x) => x !== l) : [...value.languages, l] })}
                  className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-primary/40 bg-primary/15 text-foreground" : "border-white/15 text-muted-foreground hover:bg-secondary"}`}>{l}</button>
              );
            })}
          </div>
        </div>
        <div className="md:col-span-2"><ChipInput label="Key claims" values={value.key_claims} onChange={(v) => onChange({ ...value, key_claims: v })} placeholder="e.g. Loan up to ₹40 lakh" /></div>
        <div className="md:col-span-2"><ChipInput label="Mandatory disclaimers" values={value.mandatory_disclaimers} onChange={(v) => onChange({ ...value, mandatory_disclaimers: v })} placeholder="e.g. T&Cs apply. Read all scheme related documents carefully." /></div>
        <div className="md:col-span-2">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Notes</label>
          <Textarea value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} rows={3} className="mt-1" />
        </div>
      </div>
    </div>
  );
}
