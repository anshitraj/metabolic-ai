"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import { useInView } from "motion/react";

const Film = dynamic(() => import("./motion-film"), { ssr: false, loading: Placeholder });
function Placeholder() {
  return <div className="ml-film-player"><div className="ml-film-placeholder"><div><div className="mb-6 text-[11px] font-semibold uppercase tracking-[.14em] text-g-200">One organism. Four financial states.</div><strong>See its survival<br />instinct in motion.</strong><p className="mt-5 text-[12px] text-g-200">Preparing the motion study…</p></div></div></div>;
}
export function MotionPreview() {
  const ref = useRef<HTMLDivElement>(null);
  const ready = useInView(ref, { once: true, margin: "250px" });
  return <div ref={ref}>{ready ? <Film /> : <Placeholder />}</div>;
}
