import type { OperatingState, Tier } from "@/lib/economics/types";

// Visual parameters per operating state (docs/05 §7). Everything tweens toward
// these; nothing snaps.

export type OrganismParams = {
  scale: number;
  noiseAmp: number;
  breathHz: number;
  emissive: number;
  color: [number, number, number];
  deep: [number, number, number];
  density: number; // fraction of lattice edges/nodes visible
  ringSpeed: number;
  integrity: number; // outer ring continuity (1 = whole, 0 = broken)
  particleRate: number;
  bloom: number;
  heartbeat: number; // 0..1 blend toward the survival double beat
};

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const STATE_PARAMS: Record<OperatingState, OrganismParams> = {
  ABUNDANCE: { scale: 1, noiseAmp: 0.075, breathHz: 0.22, emissive: 1, color: hex("#35e39a"), deep: hex("#0b5a3a"), density: 1, ringSpeed: 1, integrity: 1, particleRate: 1, bloom: 0.75, heartbeat: 0 },
  DEFENSIVE: { scale: 0.86, noiseAmp: 0.05, breathHz: 0.18, emissive: 0.9, color: hex("#ffb547"), deep: hex("#6b4210"), density: 0.55, ringSpeed: 0.55, integrity: 0.85, particleRate: 0.6, bloom: 0.65, heartbeat: 0 },
  SURVIVAL: { scale: 0.68, noiseAmp: 0.025, breathHz: 0.9, emissive: 0.8, color: hex("#ff5a6a"), deep: hex("#6e1424"), density: 0.18, ringSpeed: 0.18, integrity: 0.25, particleRate: 0.12, bloom: 0.6, heartbeat: 1 },
  RECOVERY: { scale: 0.84, noiseAmp: 0.055, breathHz: 0.28, emissive: 0.9, color: hex("#7c9bff"), deep: hex("#1f3070"), density: 0.6, ringSpeed: 0.5, integrity: 0.7, particleRate: 0.6, bloom: 0.7, heartbeat: 0 },
};

/** Inner ring radius by model tier: the more capable the model, the wider the orbit. */
export const TIER_RING: Record<Tier, { radius: number; width: number }> = {
  premium: { radius: 2.05, width: 2.0 },
  standard: { radius: 1.92, width: 1.5 },
  economy: { radius: 1.8, width: 1.1 },
};

export const AMBER: [number, number, number] = hex("#ffb547");
export const MINT: [number, number, number] = hex("#4cf0aa");
export const BLUE: [number, number, number] = hex("#8aa6ff");
export const WHITE: [number, number, number] = [0.92, 1, 0.95];
