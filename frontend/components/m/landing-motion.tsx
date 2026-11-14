"use client";

import { useEffect, useRef } from "react";
import { useLive } from "@/lib/client/live";

/** Native reveal animations: no scroll handlers, no React updates per frame. */
export function LandingMotion() {
  const marker = useRef<HTMLDivElement>(null);
  const reduced = useLive((s) => s.reducedEffects);
  useEffect(() => {
    const root = marker.current?.closest(".ml-landing");
    if (!root || reduced || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>(".ml-hero-logos, .ml-section-heading, .ml-tour, .ml-flow-shell, .ml-provider-tile, .ml-feature-copy, .ml-pass-display, .ml-state-card, .ml-api-tour, .ml-proof-card, .ml-film-player, .ml-faq-items, .ml-footer-invitation, .ml-footer-wordmark"));
    // Batch layout reads before applying any styles.
    const belowFold = targets.map((el) => el.getBoundingClientRect().top > innerHeight * 0.92);
    targets.forEach((el, i) => {
      el.classList.add("ml-motion-target");
      if (belowFold[i]) el.classList.add("ml-enter-pending");
      el.style.setProperty("--enter-delay", `${el.matches(".ml-provider-tile, .ml-state-card") ? i % 4 * 65 : 0}ms`);
    });
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        e.target.classList.toggle("ml-in-view", e.isIntersecting);
        if (e.isIntersecting) e.target.classList.remove("ml-enter-pending");
      }
    }, { threshold: 0.08, rootMargin: "0px 0px -20px 0px" });
    targets.forEach((el) => observer.observe(el));
    return () => { observer.disconnect(); targets.forEach((el) => el.classList.remove("ml-enter-pending", "ml-in-view", "ml-motion-target")); };
  }, [reduced]);
  return <div ref={marker} className="ml-reading-progress" aria-hidden />;
}
