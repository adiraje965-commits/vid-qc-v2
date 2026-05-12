import { useEffect, useRef, useState } from "react";
import { Film, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { listPlaybookAssets, type PbAsset } from "@/lib/playbook-picker";

type Props = {
  boardUrl: string;
  disabled?: boolean;
  onPick: (asset: PbAsset) => void;
};

export function PlaybookAssetPicker({ boardUrl, disabled, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [assets, setAssets] = useState<PbAsset[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const reqIdRef = useRef(0);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset + fetch first page when board URL or query changes
  useEffect(() => {
    if (!boardUrl) return;
    const myReq = ++reqIdRef.current;
    setAssets([]);
    setCursor(null);
    setHasMore(true);
    setError(null);
    setLoading(true);
    listPlaybookAssets({ url: boardUrl, cursor: null, query: debounced, pageSize: 50 })
      .then((res) => {
        if (myReq !== reqIdRef.current) return;
        if (!res.ok) { setError(res.error ?? "Failed to load board"); setHasMore(false); return; }
        setAssets(res.assets ?? []);
        setCursor(res.nextCursor ?? null);
        setHasMore(!!res.hasMore);
      })
      .finally(() => { if (myReq === reqIdRef.current) setLoading(false); });
  }, [boardUrl, debounced]);

  // Infinite scroll: load next page when sentinel is visible
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loading) return;
    const el = sentinelRef.current;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || loading || !hasMore) return;
      const myReq = ++reqIdRef.current;
      setLoading(true);
      listPlaybookAssets({ url: boardUrl, cursor, query: debounced, pageSize: 50 })
        .then((res) => {
          if (myReq !== reqIdRef.current) return;
          if (!res.ok) { setError(res.error ?? "Failed to load more"); setHasMore(false); return; }
          setAssets((prev) => {
            const seen = new Set(prev.map((a) => a.token));
            const next = (res.assets ?? []).filter((a) => !seen.has(a.token));
            return [...prev, ...next];
          });
          setCursor(res.nextCursor ?? null);
          setHasMore(!!res.hasMore);
        })
        .finally(() => { if (myReq === reqIdRef.current) setLoading(false); });
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [boardUrl, cursor, debounced, hasMore, loading]);

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium">Pick the video to QC</div>
        <div className="text-[11px] text-muted-foreground">
          {assets.length} loaded{hasMore ? "…" : ""}
        </div>
      </div>
      <div className="relative mb-3">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title…"
          className="h-8 pl-7 text-xs"
        />
      </div>

      {error && (
        <div className="mb-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
          {error}
        </div>
      )}

      <div className="max-h-[420px] overflow-y-auto">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {assets.map((a) => (
            <button
              key={a.token}
              type="button"
              disabled={disabled}
              onClick={() => onPick(a)}
              className="group flex flex-col gap-1 rounded-md border border-border bg-background p-2 text-left transition hover:border-primary disabled:opacity-50"
            >
              <div className="relative aspect-video w-full overflow-hidden rounded bg-muted">
                {a.thumbnail ? (
                  <img src={a.thumbnail} alt={a.title ?? "asset"} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground"><Film className="h-5 w-5" /></div>
                )}
                {a.duration != null && (
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{Math.round(a.duration)}s</span>
                )}
              </div>
              <div className="line-clamp-2 text-xs">{a.title ?? a.token}</div>
            </button>
          ))}
        </div>

        {!loading && assets.length === 0 && !error && (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {debounced ? "No videos match your search." : "No videos on this board."}
          </div>
        )}

        {hasMore && <div ref={sentinelRef} className="h-8" />}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}

        {!hasMore && assets.length > 0 && (
          <div className="py-3 text-center text-[11px] text-muted-foreground">End of board</div>
        )}
      </div>
    </div>
  );
}
