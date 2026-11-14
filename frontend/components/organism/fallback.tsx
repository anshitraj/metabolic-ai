import type { OperatingState } from "@/lib/economics/types";

const C: Record<OperatingState, { core: string; light: string; scale: number; dots: number; spin: string; beat: boolean; ringOpacity: number; dash?: string }> = {
  ABUNDANCE: { core: "#35e39a", light: "#d6ffec", scale: 1, dots: 1, spin: "38s", beat: false, ringOpacity: 0.55 },
  DEFENSIVE: { core: "#ffb547", light: "#fff0d2", scale: 0.86, dots: 0.7, spin: "60s", beat: false, ringOpacity: 0.45 },
  SURVIVAL: { core: "#ff5a6a", light: "#ffd9dd", scale: 0.68, dots: 0.42, spin: "160s", beat: true, ringOpacity: 0.3, dash: "5 9" },
  RECOVERY: { core: "#7c9bff", light: "#e1e8ff", scale: 0.84, dots: 0.75, spin: "70s", beat: false, ringOpacity: 0.45, dash: "16 6" },
};

const f = (n: number) => n.toFixed(2);

// A sphere of points (Fibonacci lattice), projected once. Deterministic, so
// server and client render the same markup.
const POINTS = (() => {
  const out: { x: number; y: number; z: number; k: number }[] = [];
  const N = 210;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    // Tilt slightly so the pattern doesn't read as rings.
    const x = Math.cos(a) * r;
    const z0 = Math.sin(a) * r;
    const ty = y * 0.94 - z0 * 0.34;
    const tz = y * 0.34 + z0 * 0.94;
    out.push({ x, y: ty, z: tz, k: ((i * 7919) % 100) / 100 });
  }
  return out;
})();

/**
 * Lightweight 2D organism matching the 3D one: a glowing point-cloud sphere
 * with orbit lines. Used when WebGL is unavailable, in small UI spots, and on
 * the landing tiles. `filaments={false}` renders the simple glyph for tiny sizes.
 */
export function OrganismFallback({ state, size = "100%", filaments = true, label }: { state: OperatingState; size?: number | string; filaments?: boolean; label?: string }) {
  const c = C[state];
  const id = `orb-${state}-${filaments ? "d" : "s"}`;
  const R = 62 * c.scale;
  return (
    <svg viewBox="0 0 300 300" width={size} height={size} role="img" aria-label={label ?? `Organism in ${state.toLowerCase()} state`} style={{ ["--m-spin" as string]: c.spin }}>
      <defs>
        <radialGradient id={`${id}-aura`}>
          <stop offset="0" stopColor={c.core} stopOpacity=".5" />
          <stop offset=".45" stopColor={c.core} stopOpacity=".14" />
          <stop offset="1" stopColor={c.core} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-core`} cx="46%" cy="42%">
          <stop offset="0" stopColor={c.light} stopOpacity=".95" />
          <stop offset=".5" stopColor={c.core} stopOpacity=".55" />
          <stop offset="1" stopColor={c.core} stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="150" cy="150" r={f(R * 2.3)} fill={`url(#${id}-aura)`} />

      {filaments && (
        <>
          <g className="m-spin-rev" opacity={c.ringOpacity * 0.6}>
            <ellipse cx="150" cy="150" rx="138" ry="46" fill="none" stroke={c.light} strokeWidth=".8" strokeDasharray={c.dash ?? "1 5"} transform="rotate(14 150 150)" />
          </g>
          <ellipse cx="150" cy="150" rx="124" ry="34" fill="none" stroke={c.core} strokeOpacity={c.ringOpacity} strokeWidth="1" transform="rotate(-12 150 150)" />
          <g className="m-spin">
            <ellipse cx="150" cy="150" rx={f(R * 1.62)} ry={f(R * 1.62)} fill="none" stroke={c.core} strokeOpacity={c.ringOpacity * 0.7} strokeWidth=".9" strokeDasharray={c.dash} />
            <circle cx="150" cy={f(150 - R * 1.62)} r="3.2" fill="#f4fff8" />
          </g>
        </>
      )}

      <g className={c.beat ? "m-beat" : "m-breath"}>
        <circle cx="150" cy="150" r={f(R * (filaments ? 0.95 : 1.15))} fill={`url(#${id}-core)`} />
        {filaments &&
          POINTS.map((p, i) => {
            if (p.k > c.dots) return null;
            const front = (p.z + 1) / 2;
            return <circle key={i} cx={f(150 + p.x * R)} cy={f(150 - p.y * R)} r={f(0.7 + front * 1.25)} fill={front > 0.72 ? c.light : c.core} opacity={f(0.12 + front * 0.78)} />;
          })}
      </g>

      {filaments && <circle cx={f(150 + 124 * Math.cos(-0.5))} cy={f(150 + 34 * Math.sin(-0.5) - 26)} r="2.6" fill={c.light} opacity=".9" />}
    </svg>
  );
}
