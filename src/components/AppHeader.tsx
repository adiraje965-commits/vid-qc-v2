import { BarChart3, LineChart, ListPlus, LogOut, Plus, ShieldCheck } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

export function AppHeader() {
  const loc = useLocation();
  const { user, isAdmin, signOut } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-background/88 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-6 px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 shadow-[0_0_24px_hsl(var(--primary)/0.18)] ring-1 ring-primary/35">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Bajaj Finance</div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Video QC Engine</div>
          </div>
        </Link>
        <nav className="ml-4 flex items-center gap-1 rounded-lg border border-white/8 bg-secondary/30 p-1 text-sm">
          {[
            { to: "/", label: "Dashboard", icon: BarChart3 },
            { to: "/new", label: "New", icon: Plus },
            { to: "/bulk", label: "Bulk", icon: ListPlus },
            { to: "/trends", label: "Trends", icon: LineChart },
          ].map((n) => {
            const active = n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition-all hover:bg-secondary hover:text-foreground",
                  active && "bg-primary/15 text-foreground shadow-sm ring-1 ring-primary/20"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-md border border-score-good/20 bg-score-good/8 px-2.5 py-1 text-xs text-muted-foreground md:flex">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-score-good shadow-[0_0_12px_hsl(var(--score-good))]" />
            QC Engine Online
          </div>
          {user && (
            <div className="flex items-center gap-2 text-xs">
              <span className="hidden text-muted-foreground md:inline">{user.email}{isAdmin && " · admin"}</span>
              <Button size="sm" variant="ghost" onClick={signOut}><LogOut className="h-3.5 w-3.5" /></Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
