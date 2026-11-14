"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LogoMark } from "@/components/logo";
import { OrganismFallback } from "@/components/organism/fallback";
import { STATE_META, useLive, useRealFeed } from "@/lib/client/live";
import { SessionProvider, useSession } from "@/lib/client/session";
import { formatRunway, formatUsd, big } from "@/lib/economics/money";
import { cx, StateChip, TimeAgo } from "./ui";

type Nav = { href: string; label: string; icon: React.ReactNode };
const I = (d: React.ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
export const NAV: Nav[] = [
  { href: "/console", label: "Overview", icon: I(<><circle cx="12" cy="12" r="3.5" /><circle cx="12" cy="12" r="8.5" strokeDasharray="2 3" /></>) },
  { href: "/console/workspace", label: "AI Workspace", icon: I(<path d="M4 5h16v11H8l-4 4V5Z" />) },
  { href: "/console/treasury", label: "Treasury", icon: I(<><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 12.5h2M3 10h18" /></>) },
  { href: "/console/models", label: "AI models", icon: I(<><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 12h4l4-5M12 12l4 5" /></>) },
  { href: "/console/decisions", label: "Decisions", icon: I(<path d="M5 4h14M5 9h14M5 14h9M5 19h6" />) },
  { href: "/console/stress-lab", label: "Stress Lab", icon: I(<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10" />) },
  { href: "/console/receipts", label: "Receipts", icon: I(<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6" />) },
  { href: "/console/developers", label: "Developers", icon: I(<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />) },
];
// Grouped by what a visitor wants to do, so nine links read as four ideas.
const GROUPS: { label: string; hrefs: string[] }[] = [
  { label: "Watch it", hrefs: ["/console", "/console/stress-lab"] },
  { label: "Use it", hrefs: ["/console/workspace", "/console/treasury"] },
  { label: "Check its work", hrefs: ["/console/models", "/console/decisions", "/console/receipts"] },
  { label: "Build on it", hrefs: ["/console/developers"] },
];
const SETTINGS: Nav = { href: "/console/settings", label: "Settings", icon: I(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>) };

const isActive = (path: string, href: string) => (href === "/console" ? path === "/console" : path === href || path.startsWith(href + "/"));

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Frame>{children}</Frame>
    </SessionProvider>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const simPage = path.startsWith("/console/stress-lab");
  useRealFeed(!simPage);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close the drawer on navigation
    setDrawer(false);
  }, [path]);

  return (
    <div className="m-app flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-line bg-paper-sunken lg:flex">
        <Sidebar path={path} />
      </aside>
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-ink/30 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-line bg-paper-sunken lg:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              role="dialog"
              aria-label="Navigation"
            >
              <Sidebar path={path} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setDrawer(true)} simPage={simPage} />
        {!simPage && <Banners overviewPage={path === "/console"} />}
        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({ path }: { path: string }) {
  const overview = useLive((s) => s.overview);
  const item = (n: Nav) => {
    const active = isActive(path, n.href);
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? "page" : undefined}
        className={cx(
          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] transition-colors",
          active ? "border border-line bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(14,20,16,.04)]" : "border border-transparent text-ink-2 hover:bg-surface/60 hover:text-ink",
        )}
      >
        <span className={active ? "text-g-700" : "text-muted"}>{n.icon}</span>
        {n.label}
        {n.href === "/console/stress-lab" && <span className="ml-auto rounded bg-sim-tint px-1.5 text-[10px] font-semibold uppercase text-sim">sim</span>}
      </Link>
    );
  };
  return (
    <div className="flex h-full flex-col px-3 py-4">
      <Link href="/" className="mb-5 flex items-center gap-2.5 px-2 text-[15px] font-semibold">
        <LogoMark size={24} />
        Metabolic <span className="font-normal text-muted">AI</span>
      </Link>
      <nav className="flex flex-col gap-0.5" aria-label="Console">
        {GROUPS.map((g) => (
          <div key={g.label} className="mb-2">
            <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">{g.label}</div>
            {NAV.filter((n) => g.hrefs.includes(n.href)).map(item)}
          </div>
        ))}
        <div className="my-2 h-px bg-line" />
        {item(SETTINGS)}
      </nav>
      <Link href="/console" className="mt-auto flex items-center gap-3 rounded-xl bg-stage p-3 text-stage-ink" aria-label="Current operating state">
        <div className="h-11 w-11 shrink-0">
          <OrganismFallback state={overview?.state ?? "ABUNDANCE"} filaments={false} />
        </div>
        <div className="min-w-0 text-[12px] leading-[17px]">
          <div className="font-semibold">{overview ? STATE_META[overview.state].label : "Connecting…"}</div>
          <div className="truncate text-stage-muted">{overview ? (overview.simulated ? "simulated scenario" : `runway ${formatRunway(overview.runwaySeconds)}`) : "reading treasury"}</div>
        </div>
      </Link>
    </div>
  );
}

function TopBar({ onMenu, simPage }: { onMenu: () => void; simPage: boolean }) {
  const overview = useLive((s) => s.overview);
  const connection = useLive((s) => s.connection);
  const { me, config, loading, signOut } = useSession();
  const [menu, setMenu] = useState(false);
  const network = config?.network ?? overview?.network ?? "testnet";
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-paper/90 px-4 backdrop-blur sm:px-6">
      <button type="button" onClick={onMenu} className="-ml-1 rounded-md p-1.5 text-ink-2 hover:bg-paper-sunken lg:hidden" aria-label="Open navigation">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[12px] font-semibold uppercase tracking-wide text-g-700">
        <span className="h-1.5 w-1.5 rounded-full bg-g-500" /> {network}
      </span>
      {!simPage && overview && <span className="hidden sm:inline-flex"><StateChip state={overview.state} /></span>}
      {!simPage && (
        <span className="hidden items-center gap-1.5 text-[12px] text-muted md:inline-flex" title="Provider health">
          {(overview?.providers ?? []).filter((p) => p.configured).map((p) => (
            <span key={p.provider} className="inline-flex items-center gap-1" title={`${p.provider}: ${p.configured ? p.health : "not configured"}`}>
              <span className={cx("h-2 w-2 rounded-full", !p.configured ? "bg-line-strong" : p.health === "ok" ? "bg-g-500" : p.health === "degraded" ? "bg-df" : "bg-sv")} />
              {p.provider}
            </span>
          ))}
        </span>
      )}
      {!simPage && connection !== "live" && overview && (
        <span className="hidden rounded-full bg-df-tint px-2 py-0.5 text-[11.5px] font-semibold text-df-text sm:inline">{connection === "offline" ? "Offline" : "Reconnecting…"}</span>
      )}
      <div className="ml-auto flex items-center gap-2">
        <Notifications />
        {loading ? null : me?.user ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((v) => !v)}
              className="flex h-8 items-center gap-2 rounded-full border border-line bg-surface pl-1 pr-3 text-[13px] font-medium hover:border-line-strong"
              aria-expanded={menu}
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-g-50 text-[11px] font-bold text-g-700">{me.user.accountId.slice(0, 1).toUpperCase()}</span>
              <span className="max-w-[80px] truncate font-mono text-[12px] sm:max-w-[140px]">{me.user.accountId}</span>
            </button>
            {menu && (
              <div className="absolute right-0 top-10 z-40 w-64 rounded-xl border border-line bg-surface p-2 shadow-[0_12px_40px_rgba(14,20,16,.12)]" onMouseLeave={() => setMenu(false)}>
                <div className="px-2 py-2 text-[12px] text-muted">
                  Signed in as <span className="font-mono text-ink">{me.user.accountId}</span>
                  {me.user.role === "operator" && <span className="ml-1 rounded bg-ink px-1 text-[10px] font-semibold uppercase text-white">operator</span>}
                </div>
                <div className="px-2 pb-2 text-[13px]">
                  Credits <span className="m-num font-semibold">{formatUsd(big(me.credits?.available))}</span>
                </div>
                <Link href="/console/treasury?deposit=credits" className="block rounded-md px-2 py-1.5 text-[13px] hover:bg-paper-sunken">Add credit</Link>
                <Link href="/console/settings" className="block rounded-md px-2 py-1.5 text-[13px] hover:bg-paper-sunken">Settings</Link>
                <button type="button" onClick={() => void signOut()} className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] text-sv-text hover:bg-sv-tint">Sign out</button>
              </div>
            )}
          </div>
        ) : (
          <Link href="/login" className="inline-flex h-8 items-center rounded-md bg-g-700 px-3 text-[13px] font-semibold text-white hover:bg-[#095c3b]">Sign in</Link>
        )}
      </div>
    </header>
  );
}

const EVENT_TEXT: Record<string, (p: Record<string, unknown>) => string> = {
  "treasury.deposit.confirmed": (p) => `Deposit confirmed · ${formatUsd(big(p.usd as string))}`,
  "inference.completed": (p) => `Request served · ${String(p.tier ?? "")} · ${formatUsd(big(p.charge as string))}`,
  "inference.failed": (p) => `Request failed · ${String(p.error ?? "")}`,
  "model.switched": (p) => `Model switched → ${String(p.label ?? p.to ?? "")}`,
  "economic.state.changed": (p) => `State ${String(p.from)} → ${String(p.to)}`,
  "receipt.finalized": (p) => `Receipt finalized · ${String(p.receiptId)}`,
  "receipt.failed": (p) => `Receipt failed · ${String(p.receiptId)}`,
  "provider.unhealthy": (p) => `Provider down · ${String(p.provider)}`,
  "provider.recovered": (p) => `Provider recovered · ${String(p.provider)}`,
};

function Notifications() {
  const events = useLive((s) => s.events);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const items = events.filter((e) => EVENT_TEXT[e.type]);
  const unread = items.length > 0 && items[0].id !== seen;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (items[0]) setSeen(items[0].id);
        }}
        className="relative grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:bg-paper-sunken"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 21h4" />
        </svg>
        {unread && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-g-500" />}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-40 w-80 rounded-xl border border-line bg-surface p-2 shadow-[0_12px_40px_rgba(14,20,16,.12)]" onMouseLeave={() => setOpen(false)}>
          <div className="px-2 py-1.5 text-[12px] font-semibold text-muted">Live activity</div>
          {items.length === 0 ? (
            <div className="px-2 pb-3 text-[13px] text-ink-2">Nothing yet. Events appear here as the business works.</div>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.slice(0, 20).map((e) => (
                <li key={e.id} className="flex justify-between gap-3 rounded-md px-2 py-1.5 text-[13px] hover:bg-paper-sunken">
                  <span className="min-w-0 truncate">{EVENT_TEXT[e.type](e.payload)}</span>
                  <TimeAgo iso={e.ts} className="shrink-0 text-[11.5px] text-muted" />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Banners({ overviewPage }: { overviewPage: boolean }) {
  const overview = useLive((s) => s.overview);
  const error = useLive((s) => s.overviewError);
  if (error && !overview)
    return (
      <div role="alert" className="border-b border-sv/30 bg-sv-tint px-6 py-2 text-[13px] text-sv-text">
        Can&apos;t reach the economy API: {error}
      </div>
    );
  if (!overview) return null;
  if (overview.paused)
    return <div className="border-b border-line bg-paper-sunken px-6 py-2 text-[13px] text-ink-2"><b>Paused by the operator.</b> All inference is disabled until the business is resumed.</div>;
  // The Overview already explains Survival in its status line.
  if (overview.state === "SURVIVAL" && !overviewPage)
    return (
      <div role="status" className="border-b border-sv/30 bg-sv-tint px-6 py-2 text-[13px] text-sv-text">
        <b>Survival mode</b> — premium inference paused. Spendable funds {formatUsd(big(overview.spendable))} after the {formatUsd(big(overview.hardReserve))} reserve.{" "}
        <Link href="/console/treasury?deposit=capital" className="font-semibold underline">Deposit NEAR to restore service.</Link>
      </div>
    );
  return null;
}
