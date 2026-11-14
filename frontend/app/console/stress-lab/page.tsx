"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/lib/client/session";
import { api } from "@/lib/client/api";
import { StressLab } from "@/components/m/stress-lab";
import { ConnectWallet } from "@/components/m/wallet";
import { ButtonLink, Button, PageHeader } from "@/components/m/ui";

export default function StressLabPage() {
  const { me, config } = useSession();
  const [receipt, setReceipt] = useState<{ state: "idle" | "busy" | "done" | "error"; text?: string; href?: string }>({ state: "idle" });
  const publish = async () => {
    setReceipt({ state: "busy" });
    try {
      const r = await api<{ receiptId: string; explorer: string }>("/api/receipts", { method: "POST" });
      setReceipt({ state: "done", text: `Receipt ${r.receiptId} finalized.`, href: r.explorer });
    } catch (e) {
      setReceipt({ state: "error", text: e instanceof Error ? e.message : "Failed." });
    }
  };
  return (
    <div>
      <PageHeader
        title="Stress Lab"
        description="See how the AI business responds when costs rise, customers leave or funds run low. Choose a scenario, then follow its model choices and financial health."
        actions={<ButtonLink href="/demo" variant="secondary" size="sm">Walk me through it →</ButtonLink>}
      />
      <StressLab
        realActions={
          me?.user ? (
            <div className="flex flex-col gap-2">
              <ButtonLink href="/console/treasury" variant="green" size="sm">Deposit testnet NEAR</ButtonLink>
              <Button size="sm" variant="ink" onClick={publish} loading={receipt.state === "busy"} disabled={!config?.receipts.ok}>
                Publish on-chain receipt
              </Button>
              {!config?.receipts.ok && <span className="text-[11.5px] text-muted">Receipts not configured: {config?.receipts.reason}</span>}
              {receipt.text && (
                <span className={receipt.state === "error" ? "text-[12px] text-sv-text" : "text-[12px] text-g-900"}>
                  {receipt.text} {receipt.href && <a href={receipt.href} target="_blank" rel="noreferrer" className="font-semibold underline">Explorer ↗</a>}
                </span>
              )}
              <Link href="/verify" className="text-[12px] font-semibold text-g-700 hover:underline">Verify a receipt →</Link>
            </div>
          ) : (
            <ConnectWallet size="sm" />
          )
        }
      />
    </div>
  );
}
