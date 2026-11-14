// Integer money helpers. Safe for both server and browser.
// USD: micro-dollars (1n = $0.000001). NEAR: yoctoNEAR (10^24 = 1 NEAR).
// Ratios: basis points (10000 = 100%).

export const MICRO = 1_000_000n;
export const YOCTO = 10n ** 24n;

/** a * b / d, rounded half away from zero. */
export function mulDivRound(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError("division by zero");
  const n = a * b;
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = an / ad;
  const r = an % ad;
  const rounded = r * 2n >= ad ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/** a * b / d, rounded up (toward +infinity) for non-negative inputs. */
export function mulDivCeil(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError("division by zero");
  const n = a * b;
  if (n <= 0n) return n / d;
  return (n + d - 1n) / d;
}

/** Token cost in micro-USD for `tokens` at `perMillion` micro-USD per 1M tokens, rounded up. */
export function tokenCost(tokens: number, perMillion: bigint): bigint {
  if (!Number.isInteger(tokens) || tokens < 0) throw new RangeError("tokens must be a non-negative integer");
  return mulDivCeil(BigInt(tokens), perMillion, 1_000_000n);
}

/** Margin in basis points, or null when revenue is zero. */
export function marginBp(revenue: bigint, cost: bigint): number | null {
  if (revenue <= 0n) return null;
  return Number(mulDivRound(revenue - cost, 10_000n, revenue));
}

/** Ratio a/b in basis points (b > 0). Clamped to a safe integer range. */
export function ratioBp(a: bigint, b: bigint): number {
  if (b <= 0n) return a > 0n ? 1_000_000_000 : 0;
  const v = mulDivRound(a, 10_000n, b);
  if (v > 1_000_000_000n) return 1_000_000_000;
  if (v < -1_000_000_000n) return -1_000_000_000;
  return Number(v);
}

/** Parse "1.25" (USD) into micro-USD. Returns null for invalid input or more than 6 places. */
export function parseUsd(value: string): bigint | null {
  return parseDecimal(value, 6);
}

/** Parse "2.5" (NEAR) into yoctoNEAR. */
export function parseNear(value: string): bigint | null {
  return parseDecimal(value, 24);
}

export function parseDecimal(value: string, decimals: number): bigint | null {
  const v = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  const neg = v.startsWith("-");
  const [whole, frac = ""] = (neg ? v.slice(1) : v).split(".");
  if (frac.length > decimals) return null;
  const n = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
  return neg ? -n : n;
}

/** Minor units → decimal string with up to `places` decimals, trailing zeros trimmed to `minPlaces`. */
export function formatDecimal(minor: bigint, decimals: number, places = decimals, minPlaces = 0): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  // round to `places`
  const drop = decimals - places;
  let scaled = abs;
  if (drop > 0) {
    const f = 10n ** BigInt(drop);
    scaled = (abs + f / 2n) / f;
  }
  const base = 10n ** BigInt(Math.max(places, 0));
  const whole = places > 0 ? scaled / base : scaled;
  let frac = places > 0 ? (scaled % base).toString().padStart(places, "0") : "";
  while (frac.length > minPlaces && frac.endsWith("0")) frac = frac.slice(0, -1);
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${wholeStr}${frac ? "." + frac : ""}`;
}

/** "$12.31" style. Small amounts get more precision so they never show as $0.00. */
export function formatUsd(micro: bigint, opts: { precise?: boolean } = {}): string {
  const abs = micro < 0n ? -micro : micro;
  let places = 2;
  if (opts.precise || (abs > 0n && abs < 10_000n)) places = abs < 100n ? 6 : 4;
  const s = formatDecimal(abs, 6, places, 2);
  return `${micro < 0n ? "−" : ""}$${s}`;
}

export function formatNear(yocto: bigint, places = 4): string {
  return `${formatDecimal(yocto, 24, places, 2)} NEAR`;
}

export function formatBp(bp: number | null, places = 0): string {
  if (bp === null) return "—";
  return `${(bp / 100).toFixed(places)}%`;
}

export function formatCoverage(bp: number): string {
  if (bp >= 1_000_000) return "≫ 100×";
  return `${(bp / 10_000).toFixed(1)}×`;
}

export function formatRunway(seconds: number | null): string {
  if (seconds === null) return "Self-sustaining";
  if (seconds <= 0) return "None";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 365) return "> 1 year";
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** USD micro value of `yocto` NEAR at `microPerNear` micro-USD per NEAR (rounded half-up). */
export function nearToUsd(yocto: bigint, microPerNear: bigint): bigint {
  return mulDivRound(yocto, microPerNear, YOCTO);
}

export const big = (s: string | bigint | number | null | undefined): bigint => {
  if (s === null || s === undefined || s === "") return 0n;
  return typeof s === "bigint" ? s : BigInt(s);
};
