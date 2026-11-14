"use client";

import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { useLive } from "@/lib/client/live";

export function MotionProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      const saved = localStorage.getItem("metabolic:reduced-effects");
      useLive.setState({ reducedEffects: saved === null ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : saved === "1" });
    } catch {
      useLive.setState({ reducedEffects: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
    }
  }, []);
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
