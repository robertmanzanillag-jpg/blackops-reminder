import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Clapperboard, Menu, RadioTower } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { studioNavigation } from "./navigation";

function StudioBrand() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400 text-zinc-950 shadow-[0_0_30px_rgba(52,211,153,0.18)]">
        <Clapperboard className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-semibold tracking-wide text-white">KONG</p>
        <p className="hidden text-xs text-zinc-400 sm:block">AI Media Studio</p>
      </div>
    </div>
  );
}

function StudioNav({ activeHash, mobile = false }: { activeHash: string; mobile?: boolean }) {
  return (
    <nav aria-label="AI Media Studio sections" className="space-y-1">
      {studioNavigation.map((item) => {
        const Icon = item.icon;
        const link = (
          <a
            href={item.href}
            aria-current={activeHash === item.href ? "location" : undefined}
            className={`flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${
              activeHash === item.href ? "bg-emerald-400/10 text-emerald-200" : "text-zinc-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </a>
        );
        return mobile ? <SheetClose key={item.href} asChild>{link}</SheetClose> : <div key={item.href}>{link}</div>;
      })}
    </nav>
  );
}

export function StudioShell({ children }: { children: ReactNode }) {
  const [activeHash, setActiveHash] = useState(() => typeof window === "undefined" ? "#overview" : window.location.hash || "#overview");

  useEffect(() => {
    const updateHash = () => setActiveHash(window.location.hash || "#overview");
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, []);

  return (
    <div className="min-h-screen bg-[#050706] text-zinc-100">
      <a href="#studio-main" className="sr-only z-[100] rounded bg-emerald-300 px-4 py-2 text-zinc-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to studio content
      </a>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_65%_-10%,rgba(52,211,153,0.09),transparent_35%)]" />

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/10 bg-black/70 p-5 backdrop-blur-xl lg:flex lg:flex-col">
        <StudioBrand />
        <div className="mt-8 flex-1"><StudioNav activeHash={activeHash} /></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <RadioTower className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
            Autonomous media engine
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-400">Provider-neutral orchestration for vertical content.</p>
        </div>
        <Link href="/" className="mt-4 flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Kong
        </Link>
      </aside>

      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/10 bg-black/80 px-4 pr-36 backdrop-blur-xl lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button type="button" size="icon" variant="outline" className="border-white/10 bg-white/5 text-white" aria-label="Open studio navigation">
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[86vw] border-white/10 bg-zinc-950 text-white">
            <SheetHeader className="text-left">
              <SheetTitle className="text-white">AI Media Studio</SheetTitle>
              <SheetDescription>Navigate the autonomous media workspace.</SheetDescription>
            </SheetHeader>
            <div className="mt-7"><StudioNav activeHash={activeHash} mobile /></div>
            <SheetClose asChild>
              <Link href="/" className="mt-6 flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-white">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Kong
              </Link>
            </SheetClose>
          </SheetContent>
        </Sheet>
        <StudioBrand />
      </header>

      <main id="studio-main" className="relative px-4 pb-14 pt-6 sm:px-6 lg:ml-64 lg:px-8 lg:pt-8">
        <div className="mx-auto max-w-[1480px]">{children}</div>
      </main>
    </div>
  );
}
