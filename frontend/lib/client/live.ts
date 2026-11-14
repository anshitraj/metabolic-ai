"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { MetabolicEvent, OperatingState, OverviewDTO } from "@/lib/economics/types";
import { api } from "./api";

// Live client state. Numbers always come from backend snapshots (`overview`);
// events only drive animation and the activity feed. Missing an event can never
// leave a number wrong — the next snapshot corrects it.

export type OrganismEffect = { id: string; type: MetabolicEvent["type"]; at: number; payload: Record<string, unknown> };
export type Connection = "connecting" | "live" | "reconnecting" | "offline";

type LiveState = {
  scope: string;
  overview: OverviewDTO | null;
  overviewError: string | null;
  events: MetabolicEvent[];
  effects: OrganismEffect[];
  connection: Connection;
  reducedEffects: boolean;
  lastSnapshotAt: number | null;
  setOverview: (o: OverviewDTO) => void;
  setOverviewError: (e: string | null) => void;
  pushEvent: (e: MetabolicEvent) => void;
  pushEffect: (e: Omit<OrganismEffect, "id" | "at"> & { at?: number }) => void;
  consumeEffects: (since: number) => OrganismEffect[];
  setConnection: (c: Connection) => void;
  setReducedEffects: (v: boolean) => void;
  reset: (scope: string) => void;
};

export const useLive = create<LiveState>((set, get) => ({
  scope: "real",
  overview: null,
  overviewError: null,
  events: [],
  effects: [],
  connection: "connecting",
  reducedEffects: false,
  lastSnapshotAt: null,
  setOverview: (o) => set({ overview: o, overviewError: null, lastSnapshotAt: Date.now() }),
  setOverviewError: (e) => set({ overviewError: e }),
  pushEvent: (e) =>
    set((s) => {
      if (s.events.some((x) => x.id === e.id)) return s;
      const events = [e, ...s.events].slice(0, 80);
      const effects = [...s.effects, { id: e.id, type: e.type, at: performance.now(), payload: e.payload }].slice(-40);
      return { events, effects };
    }),
  pushEffect: (e) =>
    set((s) => ({
      effects: [...s.effects, { id: crypto.randomUUID(), type: e.type, payload: e.payload, at: e.at ?? performance.now() }].slice(-40),
    })),
  consumeEffects: (since) => get().effects.filter((e) => e.at > since),
  setConnection: (c) => set({ connection: c }),
  setReducedEffects: (v) => {
    try {
      localStorage.setItem("metabolic:reduced-effects", v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    set({ reducedEffects: v });
  },
  reset: (scope) => set({ scope, overview: null, events: [], effects: [], connection: "connecting", lastSnapshotAt: null }),
}));

const REFRESH_ON = new Set<MetabolicEvent["type"]>([
  "treasury.deposit.confirmed",
  "inference.completed",
  "inference.failed",
  "model.switched",
  "economic.state.changed",
  "receipt.finalized",
  "snapshot.updated",
  "provider.unhealthy",
  "provider.recovered",
]);

/**
 * Subscribe to the real economy: initial snapshot, SSE events, periodic
 * resync, and reconnection with Last-Event-ID handled by EventSource.
 */
export function useRealFeed(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const live = useLive.getState();
    if (live.scope !== "real") live.reset("real");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = async () => {
      try {
        const o = await api<OverviewDTO>("/api/dashboard/overview");
        if (!cancelled) useLive.getState().setOverview(o);
      } catch (e) {
        if (!cancelled) useLive.getState().setOverviewError(e instanceof Error ? e.message : "Could not load the economy.");
      }
    };
    const scheduleRefresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 400);
    };
    void refresh();
    const es = new EventSource("/api/events/stream?scope=real");
    es.onopen = () => {
      useLive.getState().setConnection("live");
      void refresh();
    };
    es.onerror = () => useLive.getState().setConnection(es.readyState === EventSource.CLOSED ? "offline" : "reconnecting");
    es.addEventListener("metabolic", (m) => {
      const ev = JSON.parse((m as MessageEvent).data) as MetabolicEvent;
      useLive.getState().pushEvent(ev);
      if (REFRESH_ON.has(ev.type)) scheduleRefresh();
    });
    const poll = setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      es.close();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);
}

export const STATE_META: Record<OperatingState, { label: string; color: string; text: string; tint: string; blurb: string }> = {
  ABUNDANCE: { label: "Abundance", color: "#2bd98a", text: "text-ab-text", tint: "bg-ab-tint", blurb: "Healthy margins and reserves. Premium models allowed when they pay." },
  DEFENSIVE: { label: "Defensive", color: "#f2a93b", text: "text-df-text", tint: "bg-df-tint", blurb: "Margins or reserves are thinning. Economy models preferred." },
  SURVIVAL: { label: "Survival", color: "#f0525e", text: "text-sv-text", tint: "bg-sv-tint", blurb: "Liquidity at the hard reserve. Unprofitable inference is blocked." },
  RECOVERY: { label: "Recovery", color: "#6c8cff", text: "text-rc-text", tint: "bg-rc-tint", blurb: "Funds are back. Capacity returns in steps until stable." },
};
