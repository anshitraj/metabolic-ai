"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

export type Me = { user: { id: string; accountId: string; role: "customer" | "operator" } | null; credits?: { available: string; reserved: string } };
export type PublicConfig = {
  network: string;
  contractId: string | null;
  deposit: { receiverId: string; method: "deposit" | "transfer" } | null;
  receipts: { ok: boolean; reason: string | null };
  explorerUrl: string;
  providers: { provider: string; configured: boolean }[];
  operators: number;
};

type Ctx = {
  me: Me | null;
  config: PublicConfig | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([api<Me>("/api/auth/me"), api<PublicConfig>("/api/public/config")]);
      setMe(m);
      setConfig(c);
    } catch {
      setMe({ user: null });
    } finally {
      setLoading(false);
    }
  }, []);
  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    try {
      const { getSelector } = await import("./near");
      const sel = await getSelector(config?.network ?? "testnet");
      if (sel.isSignedIn()) await (await sel.wallet()).signOut();
    } catch {
      /* wallet not connected */
    }
    await refresh();
  }, [config, refresh]);
  useEffect(() => {
    // Initial load of the session; state updates happen after the awaited fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  const value = useMemo(() => ({ me, config, loading, refresh, signOut }), [me, config, loading, refresh, signOut]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}
