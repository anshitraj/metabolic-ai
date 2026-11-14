import Link from "next/link";

/** The Metabolic mark: a cell with a living core and one half-membrane of growth. */
export function LogoMark({
  size = 26,
  onDark = false,
}: {
  size?: number;
  onDark?: boolean;
}) {
  const stroke = onDark ? "#a9f0cc" : "#0a6b44";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      aria-hidden
      className="shrink-0"
    >
      <circle cx="14" cy="14" r="14" fill="#2bd98a" />
      <ellipse
        cx="14"
        cy="14"
        rx="5.5"
        ry="10"
        transform="rotate(40 14 14)"
        fill="none"
        stroke={stroke}
        strokeWidth="2"
      />
      <ellipse
        cx="14"
        cy="14"
        rx="5.5"
        ry="10"
        transform="rotate(-40 14 14)"
        fill="none"
        stroke={stroke}
        strokeWidth="2"
      />
      <circle cx="14" cy="14" r="3.5" fill={stroke} />
    </svg>
  );
}

export function Logo({
  href = "/",
  onDark = false,
  compact = false,
}: {
  href?: string;
  onDark?: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`m-brand inline-flex items-center gap-2 ${onDark ? "text-stage-ink" : "text-ink"}`}
      aria-label="Metabolic AI home"
    >
      <LogoMark onDark={onDark} />
      {!compact && (
        <span className="m-wordmark">
          metabolic<span className="m-wordmark-dot">.</span>
          <span className="m-brand-ai">AI</span>
        </span>
      )}
    </Link>
  );
}
