"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo } from "./logo";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/demo", label: "Watch it adapt" },
  { href: "/console/developers", label: "API" },
  { href: "/verify", label: "Verify" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-8 text-[14px] text-ink-2 md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden h-10 items-center px-3 text-sm font-semibold text-ink-2 hover:text-ink sm:inline-flex">
            Sign in
          </Link>
          <Link href="/console" className="hidden h-10 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-white hover:bg-[#1c261f] sm:inline-flex">
            Launch app →
          </Link>
          <button type="button" className="rounded-md p-2 text-ink-2 md:hidden" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d={open ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-line bg-paper px-4 py-3 md:hidden" aria-label="Mobile">
          {[...LINKS, { href: "/login", label: "Sign in" }, { href: "/console", label: "Launch app →" }].map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block py-2 text-[15px] text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
