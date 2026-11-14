"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/client/session";
import { Button, cx } from "./ui";

/**
 * Connect a NEAR wallet, then sign the server's NEP-413 challenge to open a
 * session. Two steps because wallets connect first and sign second.
 */
export function ConnectWallet({ size = "md", variant = "green", className, label = "Connect NEAR wallet", onDone }: { size?: "sm" | "md" | "lg"; variant?: "green" | "ink" | "stage"; className?: string; label?: string; onDone?: () => void }) {
  const { config, refresh } = useSession();
  const [phase, setPhase] = useState<"idle" | "connecting" | "signing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const subscribed = useRef(false);
  const network = config?.network ?? "testnet";

  const sign = async () => {
    setPhase("signing");
    setError(null);
    try {
      const { signInWithWallet } = await import("@/lib/client/near");
      await signInWithWallet(network);
      await refresh();
      setPhase("idle");
      onDone?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-in failed.";
      if (/Waiting for the wallet/.test(msg)) return; // redirect flow continues on /login
      setError(msg);
      setPhase("error");
    }
  };

  useEffect(() => {
    return () => {
      subscribed.current = false;
    };
  }, []);

  const start = async () => {
    setError(null);
    try {
      const { getSelector, showWalletModal } = await import("@/lib/client/near");
      const selector = await getSelector(network);
      if (selector.isSignedIn()) return sign();
      setPhase("connecting");
      if (!subscribed.current) {
        subscribed.current = true;
        selector.on("signedIn", () => {
          if (subscribed.current) void sign();
        });
      }
      await showWalletModal(network, config?.contractId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the wallet selector.");
      setPhase("error");
    }
  };

  return (
    <span className={cx("inline-flex flex-col items-start gap-1", className)}>
      <Button size={size} variant={variant} onClick={start} loading={phase === "signing"}>
        {phase === "signing" ? "Sign the message in your wallet…" : phase === "connecting" ? "Choose a wallet…" : label}
      </Button>
      {error && <span role="alert" className="max-w-xs text-[12px] text-sv-text">{error}</span>}
    </span>
  );
}
