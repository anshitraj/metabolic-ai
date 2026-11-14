import Link from "next/link";

/** The Metabolic mark: a cell with a living core and one half-membrane of growth. */
export function LogoMark({ size = 26, onDark = false }: { size?: number; onDark?: boolean }) {
  const stroke = onDark ? "#e8f1eb" : "#0e1410";
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden className="shrink-0">
      <circle cx="14" cy="14" r="12.5" fill="none" stroke={stroke} strokeWidth="1.5" />
      <path d="M14 1.5a12.5 12.5 0 0 1 0 25" fill="none" stroke="#12b36e" strokeWidth="1.6" />
      <circle cx="14" cy="14" r="5.5" fill="#12b36e" />
      <circle cx="12.2" cy="12.3" r="1.6" fill="#a9f0cc" />
    </svg>
  );
}

export function Logo({ href = "/", onDark = false, compact = false }: { href?: string; onDark?: boolean; compact?: boolean }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2.5 font-semibold tracking-[-0.01em] ${onDark ? "text-stage-ink" : "text-ink"}`} aria-label="Metabolic AI home">
      <LogoMark onDark={onDark} />
      {!compact && <span className="text-[17px]">Metabolic <span className="font-normal opacity-60">AI</span></span>}
    </Link>
  );
}
