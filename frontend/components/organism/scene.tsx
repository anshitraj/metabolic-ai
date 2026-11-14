"use client";
/* eslint-disable react-hooks/immutability, react-hooks/purity -- three.js uniforms and buffers are mutated inside useFrame (outside React render) and seeded with random geometry once in useMemo; this is the standard React Three Fiber pattern. */

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, Line, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import type { Line2 } from "three-stdlib";
import type { MetabolicEvent, OperatingState, Tier } from "@/lib/economics/types";
import { useLive } from "@/lib/client/live";
import { AMBER, BLUE, MINT, STATE_PARAMS, TIER_RING, WHITE, type OrganismParams } from "./params";
import {
  orbFragment,
  orbVertex,
  spriteFragment,
  spriteVertex,
  dustFragment,
  dustVertex,
  latticeFragment,
  latticeVertex,
  nodeFragment,
  nodeVertex,
  particleFragment,
  particleVertex,
} from "./shaders";

export type OrganismSelect = { kind: "model" } | { kind: "treasury" } | { kind: "event"; event: MetabolicEvent };

export type OrganismSceneProps = {
  state: OperatingState;
  tier: Tier | null;
  coverage: number; // reserve coverage ratio (1 = at reserve)
  activity: number; // requests in window → idle circulation rate
  modelLabel?: string | null;
  events: MetabolicEvent[];
  reduced: boolean;
  onSelect?: (s: OrganismSelect) => void;
  resetKey?: number;
};

// Composition (world units). Camera at z≈9.2 with a 36° fov sees ~±3 units,
// so everything sits inside a 2.8 radius and never touches the frame.
const R_CORE = 1.12;
const R_LATTICE = 1.62;
const R_MIDDLE = 2.5;
const R_OUTER = 2.8;
const ORB_POINTS = 16000;
const POOL = 2000;

type Anim = {
  p: OrganismParams;
  swell: number;
  activity: number;
  ringBoost: number;
  flash: number;
  morph: number;
  receiptPulse: number;
  idleAcc: number;
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpParams(cur: OrganismParams, t: OrganismParams, k: number) {
  for (const key of ["scale", "noiseAmp", "breathHz", "emissive", "density", "ringSpeed", "integrity", "particleRate", "bloom", "heartbeat"] as const) cur[key] = lerp(cur[key], t[key], k);
  for (let i = 0; i < 3; i++) {
    cur.color[i] = lerp(cur.color[i], t.color[i], k);
    cur.deep[i] = lerp(cur.deep[i], t.deep[i], k);
  }
}

function randomUnit(r = Math.random) {
  const u = r() * 2 - 1;
  const t = r() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t));
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const circle = (r: number, from = 0, to = Math.PI * 2, n = 160) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0);
  });

// ---------------------------------------------------------------- geometry

/** A geodesic "neural lattice" around the core plus spokes that tie it to the membrane. */
function useLattice() {
  return useMemo(() => {
    const rnd = seeded(11);
    const ico = new THREE.IcosahedronGeometry(R_LATTICE, 2);
    const edges = new THREE.EdgesGeometry(ico, 1);
    const ep = edges.getAttribute("position") as THREE.BufferAttribute;
    const pos: number[] = [];
    const prog: number[] = [];
    const ids: number[] = [];
    const SEG = 6; // subdivide edges so pulses travel smoothly and can bow outward
    for (let i = 0; i < ep.count; i += 2) {
      const a = new THREE.Vector3().fromBufferAttribute(ep, i);
      const b = new THREE.Vector3().fromBufferAttribute(ep, i + 1);
      const id = rnd();
      for (let s = 0; s < SEG; s++) {
        const p0 = a.clone().lerp(b, s / SEG).setLength(R_LATTICE);
        const p1 = a.clone().lerp(b, (s + 1) / SEG).setLength(R_LATTICE);
        pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        prog.push(s / SEG, (s + 1) / SEG);
        ids.push(id, id);
      }
    }
    // Spokes from the membrane to a subset of lattice vertices.
    const vp = ico.getAttribute("position") as THREE.BufferAttribute;
    const seen = new Set<string>();
    const verts: THREE.Vector3[] = [];
    for (let i = 0; i < vp.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(vp, i);
      const k = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
      if (!seen.has(k)) {
        seen.add(k);
        verts.push(v);
      }
    }
    verts.forEach((v) => {
      if (rnd() > 0.45) return;
      const id = rnd();
      const inner = v.clone().setLength(R_CORE * 1.02);
      pos.push(inner.x, inner.y, inner.z, v.x, v.y, v.z);
      prog.push(0, 1);
      ids.push(id, id);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aProg", new THREE.Float32BufferAttribute(prog, 1));
    g.setAttribute("aId", new THREE.Float32BufferAttribute(ids, 1));
    const ng = new THREE.BufferGeometry();
    ng.setAttribute("position", new THREE.Float32BufferAttribute(verts.flatMap((v) => [v.x, v.y, v.z]), 3));
    ng.setAttribute("aId", new THREE.Float32BufferAttribute(verts.map(() => rnd()), 1));
    ico.dispose();
    edges.dispose();
    return { edges: g, nodes: ng };
  }, []);
}

/** Evenly spread points on a unit sphere (Fibonacci lattice): the organism's body. */
function useOrb(count: number) {
  return useMemo(() => {
    const rnd = seeded(5);
    const p = new Float32Array(count * 3);
    const s = new Float32Array(count);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const a = golden * i;
      p.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
      s[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(s, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
    return g;
  }, [count]);
}

function useStarfield(count: number) {
  return useMemo(() => {
    const rnd = seeded(29);
    const p = new Float32Array(count * 3);
    const s = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // A shell behind and around the organism, never in front of the camera.
      const v = randomUnit(rnd).multiplyScalar(6 + rnd() * 9);
      p.set([v.x * 1.4, v.y, -Math.abs(v.z) - 2], i * 3);
      s[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(s, 1));
    return g;
  }, [count]);
}

function useParticlePool() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const f3 = () => new THREE.BufferAttribute(new Float32Array(POOL * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const f1 = (fill = 0) => new THREE.BufferAttribute(new Float32Array(POOL).fill(fill), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(POOL * 3), 3));
    g.setAttribute("aStart", f3());
    g.setAttribute("aEnd", f3());
    g.setAttribute("aColor", f3());
    g.setAttribute("aT0", f1(-100));
    g.setAttribute("aDur", f1(1));
    const seeds = new Float32Array(POOL);
    for (let i = 0; i < POOL; i++) seeds[i] = Math.random();
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    return g;
  }, []);
  const cursor = useRef(0);
  useEffect(() => () => geo.dispose(), [geo]);
  const spawn = (n: number, now: number, from: () => THREE.Vector3, to: () => THREE.Vector3, color: [number, number, number], dur: [number, number], spread = 0.6) => {
    const s = geo.getAttribute("aStart") as THREE.BufferAttribute;
    const e = geo.getAttribute("aEnd") as THREE.BufferAttribute;
    const c = geo.getAttribute("aColor") as THREE.BufferAttribute;
    const t0 = geo.getAttribute("aT0") as THREE.BufferAttribute;
    const d = geo.getAttribute("aDur") as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      const k = cursor.current;
      cursor.current = (cursor.current + 1) % POOL;
      const a = from();
      const b = to();
      s.setXYZ(k, a.x, a.y, a.z);
      e.setXYZ(k, b.x, b.y, b.z);
      c.setXYZ(k, color[0], color[1], color[2]);
      t0.setX(k, now + Math.random() * spread);
      d.setX(k, dur[0] + Math.random() * (dur[1] - dur[0]));
    }
    s.needsUpdate = e.needsUpdate = c.needsUpdate = t0.needsUpdate = d.needsUpdate = true;
  };
  return { geo, spawn };
}

// ---------------------------------------------------------------- organism

function Organism({ state, tier, coverage, activity, modelLabel, events, reduced, onSelect, low }: OrganismSceneProps & { low: boolean }) {
  const target = STATE_PARAMS[state];
  const anim = useRef<Anim>({
    p: { ...target, color: [...target.color] as [number, number, number], deep: [...target.deep] as [number, number, number] },
    swell: 0,
    activity: 0,
    ringBoost: 0,
    flash: 0,
    morph: 0,
    receiptPulse: -1,
    idleAcc: 0,
  });
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const lattice = useRef<THREE.Group>(null);
  const innerRing = useRef<THREE.Group>(null);
  const middleRing = useRef<THREE.Group>(null);
  const outerRing = useRef<THREE.Group>(null);
  const innerLine = useRef<Line2>(null);
  const outerLine = useRef<Line2>(null);
  const liqLine = useRef<Line2>(null);
  const pulseRing = useRef<THREE.Mesh>(null);
  const modelNode = useRef<THREE.Group>(null);
  const lastEffect = useRef(performance.now());
  const [hover, setHover] = useState<string | null>(null);
  const { size } = useThree();

  const u = useMemo(
    () => ({
      core: {
        uTime: { value: 0 },
        uAmp: { value: target.noiseAmp },
        uFlow: { value: 0.5 },
        uSize: { value: 40 },
        uDensity: { value: 1 },
        uActivity: { value: 0 },
        uColor: { value: new THREE.Color(...target.color) },
        uHot: { value: new THREE.Color(1, 1, 1) },
        uEmissive: { value: target.emissive },
        uFlash: { value: 0 },
      },
      nucleus: { uColor: { value: new THREE.Color(...target.color) }, uStrength: { value: 0.9 }, uFalloff: { value: 2.4 } },
      halo: { uColor: { value: new THREE.Color(...target.color) }, uStrength: { value: 0.22 }, uFalloff: { value: 1.6 } },
      lattice: { uTime: { value: 0 }, uColor: { value: new THREE.Color(...target.color) }, uDensity: { value: target.density }, uActivity: { value: 0 }, uSpeed: { value: 0.12 }, uBase: { value: 0.05 } },
      nodes: { uTime: { value: 0 }, uColor: { value: new THREE.Color(...target.color) }, uDensity: { value: target.density }, uScale: { value: 30 } },
      parts: { uTime: { value: 0 }, uScale: { value: 60 } },
      dust: { uTime: { value: 0 }, uScale: { value: 30 }, uColor: { value: new THREE.Color("#cfe9da") } },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const lat = useLattice();
  const orb = useOrb(low ? 7000 : ORB_POINTS);
  const stars = useStarfield(low ? 350 : 700);
  const { geo: partGeo, spawn } = useParticlePool();
  useEffect(() => () => {
    lat.edges.dispose();
    lat.nodes.dispose();
    stars.dispose();
    orb.dispose();
  }, [lat, stars, orb]);

  const ring = TIER_RING[tier ?? "standard"];
  const innerPts = useMemo(() => circle(ring.radius), [ring.radius]);
  const covFrac = Math.max(0.04, Math.min(1, coverage / 4));
  const covKey = Math.round(covFrac * 40) / 40;
  const liqPts = useMemo(() => circle(R_MIDDLE, Math.PI / 2, Math.PI / 2 + covKey * Math.PI * 2, 120), [covKey]);
  const trackPts = useMemo(() => circle(R_MIDDLE), []);
  const outerPts = useMemo(() => circle(R_OUTER, 0, Math.PI * 2, 220), []);
  const treasuryAngle = Math.PI / 2 + covKey * Math.PI * 2;

  // Model switch / state change → impulses.
  const prevTier = useRef(tier);
  useEffect(() => {
    if (prevTier.current && tier && prevTier.current !== tier) {
      anim.current.morph = 1;
      anim.current.swell -= 0.07;
    }
    prevTier.current = tier;
  }, [tier]);
  const prevState = useRef(state);
  useEffect(() => {
    if (prevState.current !== state) anim.current.swell -= state === "SURVIVAL" ? 0.1 : 0.05;
    prevState.current = state;
  }, [state]);

  const inbound = (n: number, color: [number, number, number], now: number) =>
    spawn(n, now, () => randomUnit().multiplyScalar(R_OUTER + 0.3 + Math.random() * 0.5).setZ((Math.random() - 0.5) * 1.5), () => randomUnit().multiplyScalar(R_CORE * 0.9 * anim.current.p.scale), color, [1.6, 2.6], 0.9);
  const outbound = (n: number, color: [number, number, number], now: number) =>
    spawn(n, now, () => randomUnit().multiplyScalar(R_CORE * anim.current.p.scale), () => randomUnit().multiplyScalar(R_OUTER + 0.2 + Math.random() * 0.6).setZ((Math.random() - 0.5) * 1.5), color, [1.4, 2.4], 0.6);

  useFrame((st, dtRaw) => {
    // Wall-clock step (clamped) so state transitions finish on time even when frames are throttled.
    const dt = Math.min(dtRaw, 0.5);
    const t = st.clock.elapsedTime;
    const a = anim.current;
    lerpParams(a.p, target, 1 - Math.exp(-dt * 1.3));

    for (const e of useLive.getState().effects) {
      if (e.at <= lastEffect.current) continue;
      lastEffect.current = e.at;
      switch (e.type) {
        case "treasury.deposit.confirmed":
          inbound(reduced ? 50 : 180, MINT, t);
          a.swell += 0.05;
          a.flash = 0.5;
          break;
        case "inference.started":
          a.activity = 1;
          a.ringBoost = 0.8;
          break;
        case "inference.failed":
            a.swell -= 0.03;
            a.flash = 0.35;
            a.morph = 0.6;
            break;
        case "inference.completed": {
          const cost = Number(e.payload.cost ?? 0);
          const charge = Number(e.payload.charge ?? 0);
          outbound(Math.max(16, Math.min(110, Math.round(cost / 40))), AMBER, t);
          inbound(Math.max(14, Math.min(90, Math.round(charge / 60))), MINT, t + 0.2);
          a.activity = Math.max(a.activity, 0.5);
          break;
        }
        case "model.switched":
          a.morph = 1;
          a.swell -= 0.07;
          a.flash = 0.45;
          break;
        case "economic.state.changed":
          if (e.payload.to === "RECOVERY") inbound(reduced ? 70 : 260, BLUE, t);
          a.flash = 0.35;
          break;
        case "receipt.finalized":
          a.receiptPulse = 0;
          spawn(50, t, () => new THREE.Vector3(0, R_CORE, 0).add(randomUnit().multiplyScalar(0.2)), () => new THREE.Vector3(0, 3.2, 0).add(randomUnit().multiplyScalar(1)), WHITE, [1.2, 1.8]);
          break;
        case "provider.unhealthy":
          a.flash = 0.25;
          break;
      }
    }

    // Idle circulation proportional to real activity.
    const rate = (0.5 + Math.min(activity, 60) * 0.35) * a.p.particleRate * (low || reduced ? 0.4 : 1);
    a.idleAcc += rate * dt;
    while (a.idleAcc >= 1) {
      a.idleAcc -= 1;
      if (Math.random() < 0.55) inbound(1, MINT, t);
      else outbound(1, AMBER, t);
    }

    // Breathing, or a slow double heartbeat in survival.
    const breath = 1 + 0.022 * Math.sin(t * Math.PI * 2 * a.p.breathHz);
    const ph = (t * 0.7) % 1;
    const beat = 1 + 0.07 * Math.exp(-Math.pow((ph - 0.1) / 0.035, 2)) + 0.045 * Math.exp(-Math.pow((ph - 0.27) / 0.04, 2));
    const pulse = breath * (1 - a.p.heartbeat) + beat * a.p.heartbeat;
    a.swell *= Math.exp(-dt * 2.2);
    a.flash *= Math.exp(-dt * 2.6);
    a.activity *= Math.exp(-dt * 0.8);
    a.ringBoost *= Math.exp(-dt * 1.2);
    a.morph *= Math.exp(-dt * 1.4);
    body.current?.scale.setScalar(a.p.scale * pulse * (1 + a.swell));
    lattice.current?.scale.setScalar(0.92 + a.p.scale * 0.08 + a.swell * 0.3);
    if (lattice.current) {
      lattice.current.rotation.y += dt * 0.05 * (0.4 + a.p.ringSpeed);
      lattice.current.rotation.x = Math.sin(t * 0.07) * 0.15;
    }

    const col = a.p.color;
    u.core.uTime.value = t;
    u.core.uAmp.value = a.p.noiseAmp * (reduced ? 0.6 : 1) * 1.6;
    u.core.uFlow.value = 0.25 + a.p.ringSpeed * 0.45 + a.activity * 0.5;
    u.core.uSize.value = (size.height / 13) * (low ? 1.25 : 1);
    // The body thins out as the business weakens, but always reads as a sphere.
    u.core.uDensity.value = 0.45 + a.p.density * 0.55;
    u.core.uActivity.value = a.activity;
    u.core.uEmissive.value = a.p.emissive;
    u.core.uFlash.value = a.flash;
    u.core.uColor.value.setRGB(...col);
    u.core.uHot.value.setRGB(col[0] * 0.68 + 0.32, col[1] * 0.68 + 0.32, col[2] * 0.68 + 0.32);
    u.nucleus.uColor.value.setRGB(col[0] * 0.8 + 0.2, col[1] * 0.8 + 0.2, col[2] * 0.8 + 0.2);
    u.nucleus.uStrength.value = (0.22 + 0.28 * a.p.emissive) * (1 + a.flash) * (0.8 + 0.2 * pulse);
    u.halo.uColor.value.setRGB(...col);
    u.halo.uStrength.value = 0.16 + 0.1 * a.p.emissive + a.flash * 0.2;
    u.lattice.uTime.value = t;
    u.lattice.uDensity.value = a.p.density;
    u.lattice.uActivity.value = a.activity;
    u.lattice.uSpeed.value = 0.1 + a.activity * 0.3;
    u.lattice.uColor.value.setRGB(...col);
    u.nodes.uTime.value = t;
    u.nodes.uDensity.value = a.p.density;
    u.nodes.uColor.value.setRGB(...col);
    u.nodes.uScale.value = size.height / 18;
    u.parts.uTime.value = t;
    u.parts.uScale.value = size.height / 9;
    u.dust.uTime.value = t;
    u.dust.uScale.value = size.height / 14;

    // Rings: hairlines, tinted by state.
    const speed = a.p.ringSpeed * (1 + a.ringBoost);
    if (innerRing.current) innerRing.current.rotation.z += dt * 0.32 * speed;
    if (middleRing.current) middleRing.current.rotation.z -= dt * 0.12 * speed;
    if (outerRing.current) outerRing.current.rotation.z += dt * 0.05 * speed;
    if (modelNode.current && innerRing.current) {
      // The model node sits still on the ring's frame; the ring group rotates it.
      modelNode.current.scale.setScalar(1 + a.morph * 0.8);
    }
    if (innerLine.current) {
      const m = innerLine.current.material;
      m.color.setRGB(col[0] * 1.1, col[1] * 1.1, col[2] * 1.1);
      m.opacity = 0.38 + a.morph * 0.5;
      m.linewidth = ring.width * 0.8 + a.morph * 2;
    }
    if (liqLine.current) liqLine.current.material.color.setRGB(...col);
    if (outerLine.current) {
      const m = outerLine.current.material;
      m.color.setRGB(col[0] * 0.8 + 0.2, col[1] * 0.8 + 0.2, col[2] * 0.8 + 0.2);
      // Integrity 1 → nearly continuous fine dashes; 0 → sparse fragments.
      m.dashSize = 0.06 + a.p.integrity * 0.5;
      m.gapSize = 0.04 + (1 - a.p.integrity) * 0.9;
      m.opacity = 0.18 + a.p.integrity * 0.22;
    }

    if (pulseRing.current) {
      if (a.receiptPulse >= 0) {
        a.receiptPulse += dt;
        const k = a.receiptPulse / 1.8;
        pulseRing.current.visible = k < 1;
        pulseRing.current.scale.setScalar(R_CORE + k * (R_OUTER - R_CORE + 0.3));
        (pulseRing.current.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.6;
        if (k >= 1) a.receiptPulse = -1;
      } else pulseRing.current.visible = false;
    }

    if (root.current && !reduced) {
      root.current.rotation.y += (st.pointer.x * 0.1 - root.current.rotation.y) * Math.min(1, dt * 2);
      root.current.rotation.x += (-st.pointer.y * 0.06 - root.current.rotation.x) * Math.min(1, dt * 2);
    }
  });

  const markers = events.slice(0, 6);
  const label = "pointer-events-none whitespace-nowrap rounded-md border border-white/10 bg-black/75 px-2 py-1 font-mono text-[11px] text-[#e8f1eb] backdrop-blur";
  const hoverProps = (key: string, sel: OrganismSelect) => ({
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      setHover(key);
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      setHover(null);
      document.body.style.cursor = "";
    },
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelect?.(sel);
    },
  });

  return (
    <>
      <points geometry={stars} renderOrder={-1}>
        <shaderMaterial vertexShader={dustVertex} fragmentShader={dustFragment} uniforms={u.dust} transparent depthWrite={false} />
      </points>

      <group ref={root}>
        {/* Body: a flowing cloud of light around a soft nucleus */}
        <group ref={body}>
          <Billboard>
            <mesh scale={R_CORE * 5.2} renderOrder={0}>
              <planeGeometry args={[1, 1]} />
              <shaderMaterial vertexShader={spriteVertex} fragmentShader={spriteFragment} uniforms={u.halo} transparent depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh scale={R_CORE * 1.9} renderOrder={1}>
              <planeGeometry args={[1, 1]} />
              <shaderMaterial vertexShader={spriteVertex} fragmentShader={spriteFragment} uniforms={u.nucleus} transparent depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} />
            </mesh>
          </Billboard>
          <points geometry={orb} scale={R_CORE} renderOrder={2}>
            <shaderMaterial vertexShader={orbVertex} fragmentShader={orbFragment} uniforms={u.core} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
          </points>
        </group>

        {/* Neural lattice */}
        <group ref={lattice}>
          <lineSegments geometry={lat.edges}>
            <shaderMaterial vertexShader={latticeVertex} fragmentShader={latticeFragment} uniforms={u.lattice} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
          </lineSegments>
          <points geometry={lat.nodes}>
            <shaderMaterial vertexShader={nodeVertex} fragmentShader={nodeFragment} uniforms={u.nodes} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
          </points>
        </group>

        {/* Economic circulation */}
        <points geometry={partGeo}>
          <shaderMaterial vertexShader={particleVertex} fragmentShader={particleFragment} uniforms={u.parts} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>

        {/* Inner orbit: model tier (radius and weight grow with capability) */}
        <group rotation={[1.32, 0.08, 0]}>
          <group ref={innerRing}>
            <Line ref={innerLine} points={innerPts} lineWidth={ring.width} transparent opacity={0.6} depthWrite={false} />
            <group ref={modelNode} position={[ring.radius, 0, 0]} {...hoverProps("model", { kind: "model" })}>
              <mesh>
                <sphereGeometry args={[0.06, 20, 20]} />
                <meshBasicMaterial color="#f4fff8" />
              </mesh>
              <mesh>
                <sphereGeometry args={[0.16, 16, 16]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
              {hover === "model" && (
                <Html center distanceFactor={9} position={[0, 0.3, 0]}>
                  <div className={label}>{modelLabel ?? "No model has served yet"} · inspect</div>
                </Html>
              )}
            </group>
          </group>
        </group>

        {/* Middle orbit: liquidity — the bright arc's length is reserve coverage */}
        <group rotation={[1.42, -0.22, 0]}>
          <group ref={middleRing}>
            <Line points={trackPts} color="#e8f1eb" lineWidth={0.8} transparent opacity={0.08} depthWrite={false} />
            <Line ref={liqLine} points={liqPts} lineWidth={1.4} transparent opacity={0.6} depthWrite={false} />
            <group position={[Math.cos(treasuryAngle) * R_MIDDLE, Math.sin(treasuryAngle) * R_MIDDLE, 0]} {...hoverProps("treasury", { kind: "treasury" })}>
              <mesh>
                <octahedronGeometry args={[0.065, 0]} />
                <meshBasicMaterial color="#eafff4" />
              </mesh>
              <mesh>
                <sphereGeometry args={[0.16, 12, 12]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
              {hover === "treasury" && (
                <Html center distanceFactor={9} position={[0, 0.3, 0]}>
                  <div className={label}>Treasury · {coverage.toFixed(1)}× reserve</div>
                </Html>
              )}
            </group>
          </group>
        </group>

        {/* Outer orbit: activity and integrity; event markers ride on it */}
        <group rotation={[1.5, 0.28, 0]}>
          <group ref={outerRing}>
            <Line ref={outerLine} points={outerPts} lineWidth={0.9} dashed dashSize={0.5} gapSize={0.05} transparent opacity={0.35} depthWrite={false} />
            {markers.map((ev, i) => {
              const ang = (i / 6) * Math.PI * 2 + 0.5;
              const color = ev.type.startsWith("treasury") ? "#4cf0aa" : ev.type.startsWith("receipt") ? "#ffffff" : ev.type === "inference.completed" ? "#ffb547" : ev.type === "economic.state.changed" ? "#8aa6ff" : "#bfeedd";
              return (
                <group key={ev.id} position={[R_OUTER * Math.cos(ang), R_OUTER * Math.sin(ang), 0]} {...hoverProps(ev.id, { kind: "event", event: ev })}>
                  <mesh>
                    <octahedronGeometry args={[0.045, 0]} />
                    <meshBasicMaterial color={color} />
                  </mesh>
                  <mesh>
                    <sphereGeometry args={[0.14, 10, 10]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                  </mesh>
                  {hover === ev.id && (
                    <Html center distanceFactor={9} position={[0, 0.28, 0]}>
                      <div className={label}>{ev.type}</div>
                    </Html>
                  )}
                </group>
              );
            })}
          </group>
        </group>

        {/* Receipt emission pulse */}
        <mesh ref={pulseRing} rotation={[1.42, -0.22, 0]} visible={false}>
          <torusGeometry args={[1, 0.006, 6, 160]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </>
  );
}

function Controls({ resetKey }: { resetKey?: number }) {
  const ref = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  useEffect(() => {
    ref.current?.reset();
  }, [resetKey]);
  return <OrbitControls ref={ref} enablePan={false} enableZoom minDistance={7} maxDistance={12} minPolarAngle={Math.PI / 3} maxPolarAngle={(Math.PI * 2) / 3} rotateSpeed={0.45} enableDamping />;
}

export default function OrganismScene(props: OrganismSceneProps) {
  const [low, setLow] = useState(false);
  const [visible, setVisible] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrap.current;
    let onScreen = true;
    const update = () => setVisible(onScreen && document.visibilityState === "visible");
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      update();
    });
    if (el) io.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const bloom = !props.reduced && !low;
  return (
    <div ref={wrap} className="absolute inset-0">
      <Canvas
        dpr={low || props.reduced ? 1 : [1, 1.75]}
        frameloop={visible ? "always" : "never"}
        camera={{ position: [0, 0.35, 9.2], fov: 36 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <PerformanceMonitor onDecline={() => setLow(true)} />
        <Organism {...props} low={low} />
        <Controls resetKey={props.resetKey} />
        {bloom && (
          <EffectComposer multisampling={4}>
            <Bloom intensity={STATE_PARAMS[props.state].bloom} luminanceThreshold={0.32} luminanceSmoothing={0.4} mipmapBlur radius={0.7} />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}
