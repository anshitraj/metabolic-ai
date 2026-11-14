"use client";

import Link from "next/link";
import { forwardRef, useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import type { OperatingState } from "@/lib/economics/types";
import { big, formatBp, formatNear, formatUsd } from "@/lib/economics/money";
import { STATE_META } from "@/lib/client/live";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

// ---------------------------------------------------------------- Button

type ButtonVariant = "ink" | "green" | "secondary" | "ghost" | "danger" | "stage";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  ink: "bg-ink text-white hover:bg-[#1c261f] disabled:bg-ink/40",
  green: "bg-g-700 text-white hover:bg-[#095c3b] disabled:bg-g-700/40",
  secondary: "bg-paper-sunken text-ink border border-line hover:border-line-strong disabled:opacity-50",
  ghost: "text-ink-2 hover:bg-paper-sunken hover:text-ink disabled:opacity-50",
  danger: "bg-sv-text text-white hover:bg-[#8f1d28] disabled:opacity-50",
  stage: "bg-white/8 text-stage-ink border border-stage-line hover:bg-white/14 disabled:opacity-40",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "h-11 sm:h-8 px-3 text-[13px] gap-1.5 rounded-md",
  md: "h-11 sm:h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-lg",
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }
>(function Button({ variant = "ink", size = "md", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-[background,border,color,opacity] duration-150 disabled:cursor-not-allowed",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = "ink",
  size = "md",
  className,
  children,
  ...rest
}: React.ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <Link
      href={href}
      className={cx("inline-flex items-center justify-center whitespace-nowrap font-semibold transition-colors duration-150", VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      {children}
    </Link>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cx("animate-spin", className)} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------- Chips

const STATE_ICON: Record<OperatingState, React.ReactNode> = {
  ABUNDANCE: <path d="M5 19c8 0 14-6 14-14C11 5 5 11 5 19Zm0 0 7-7" />,
  DEFENSIVE: <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />,
  SURVIVAL: <path d="M3 12h4l2-5 4 10 2-5h6" />,
  RECOVERY: <path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 4v3M5 8l2 2M19 8l-2 2" />,
};

export function StateChip({ state, size = "sm", onStage }: { state: OperatingState; size?: "sm" | "lg"; onStage?: boolean }) {
  const m = STATE_META[state];
  return (
    <span
      title={m.blurb}
      aria-label={`${m.label}: ${m.blurb}`}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-[0.08em]",
        size === "sm" ? "h-6 px-2.5 text-[10.5px]" : "h-8 px-3.5 text-xs",
        onStage ? "border border-white/10" : cx(m.tint, m.text),
      )}
      style={onStage ? { color: m.color, background: `${m.color}1f` } : undefined}
    >
      <svg width={size === "sm" ? 12 : 14} height={size === "sm" ? 12 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {STATE_ICON[state]}
      </svg>
      {m.label}
    </span>
  );
}

export function SimChip({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex h-6 items-center rounded-full border border-dashed border-sim bg-sim-tint px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-sim", className)}>
      Simulated
    </span>
  );
}

export function RealChip({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full bg-g-50 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-g-700", className)}>
      <span className="m-live-dot h-1.5 w-1.5 rounded-full bg-g-500" /> Real
    </span>
  );
}

export function EstChip() {
  return (
    <span className="ml-1 rounded bg-df-tint px-1 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-df-text" title="Estimated — not confirmed by provider usage">
      est.
    </span>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "ink" | "green" | "amber" | "red" | "blue"; className?: string }) {
  const t = {
    neutral: "bg-paper-sunken text-ink-2",
    ink: "bg-ink text-white",
    green: "bg-g-50 text-g-700",
    amber: "bg-df-tint text-df-text",
    red: "bg-sv-tint text-sv-text",
    blue: "bg-rc-tint text-rc-text",
  }[tone];
  return <span className={cx("inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold", t, className)}>{children}</span>;
}

export function TierBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return null;
  const tone = tier === "premium" ? "ink" : tier === "standard" ? "green" : "blue";
  const label = tier[0].toUpperCase() + tier.slice(1);
  return (
    <Badge tone={tone}>
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------- Layout bits

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-xl border border-line bg-surface", className)} {...rest}>
      {children}
    </div>
  );
}

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("m-label text-muted", className)}>{children}</div>;
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="font-serif text-[30px] leading-[36px] tracking-[-0.01em] text-ink sm:text-[34px] sm:leading-[40px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[14.5px] leading-6 text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-paper-sunken", className)} aria-hidden />;
}

export function Empty({ title, children, action, className }: { title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-start gap-2 rounded-xl border border-dashed border-line-strong p-6", className)}>
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {children && <div className="max-w-lg text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ title = "Something went wrong", message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sv/30 bg-sv-tint px-4 py-3 text-sm text-sv-text">
      <div>
        <b className="font-semibold">{title}.</b> {message}
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Money

export function Money({ micro, precise, className }: { micro: string | bigint | null | undefined; precise?: boolean; className?: string }) {
  if (micro === null || micro === undefined) return <span className={cx("m-num", className)}>—</span>;
  return <span className={cx("m-num", className)}>{formatUsd(big(micro), { precise })}</span>;
}

export function Near({ yocto, places = 4, className }: { yocto: string | bigint | null | undefined; places?: number; className?: string }) {
  if (yocto === null || yocto === undefined) return <span className="m-num">—</span>;
  return <span className={cx("m-num", className)}>{formatNear(big(yocto), places)}</span>;
}

export function Pct({ bp, className }: { bp: number | null | undefined; className?: string }) {
  return <span className={cx("m-num", className)}>{formatBp(bp ?? null)}</span>;
}

/** Animated numeric counter for micro-USD. Respects reduced motion. */
export function AnimatedMoney({ micro, className }: { micro: string | null | undefined; className?: string }) {
  const reduce = useReducedMotion();
  const target = micro ? Number(big(micro)) : null;
  const [display, setDisplay] = useState<number | null>(target);
  const prev = useRef<number | null>(target);
  useEffect(() => {
    if (target === null) return;
    if (reduce || prev.current === null) {
      prev.current = target;
      setDisplay(target);
      return;
    }
    const controls = animate(prev.current, target, { duration: 0.6, ease: [0.2, 0, 0, 1], onUpdate: (v) => setDisplay(v) });
    prev.current = target;
    return () => controls.stop();
  }, [target, reduce]);
  if (display === null) return <span className={cx("m-num", className)}>—</span>;
  return <span className={cx("m-num", className)}>{formatUsd(BigInt(Math.round(display)))}</span>;
}

export function Hash({ value, href, chars = 6, className }: { value: string; href?: string | null; chars?: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  const short = value.length > chars * 2 + 1 ? `${value.slice(0, chars)}…${value.slice(-chars)}` : value;
  return (
    <span className={cx("inline-flex items-center gap-1.5 font-mono text-[12.5px]", className)}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line-strong hover:decoration-current" title={value}>
          {short} ↗
        </a>
      ) : (
        <span title={value}>{short}</span>
      )}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
        className="rounded px-1 text-[11px] text-muted hover:bg-paper-sunken hover:text-ink"
        aria-label="Copy"
      >
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}

export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const text = s < 10 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : new Date(iso).toLocaleDateString();
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} className={className}>
      {text}
    </time>
  );
}

// ---------------------------------------------------------------- Dialog

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "m-0 max-h-[90dvh] w-[calc(100%-32px)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-[0_24px_80px_rgba(14,20,16,0.25)] backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]",
        "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 fixed",
        wide ? "max-w-2xl" : "max-w-md",
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-paper-sunken hover:text-ink" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="max-h-[calc(90dvh-64px)] overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="text-[12.5px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-muted focus:border-g-500 focus:ring-2 focus:ring-g-500/20";
