"use client";

import Link from "next/link";
import { useState } from "react";
import { useLive } from "@/lib/client/live";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/use-api";
import { api } from "@/lib/client/api";
import { ReceiptCard, type ReceiptDTO } from "@/components/m/receipt";
import { ConnectWallet } from "@/components/m/wallet";
import { Button, Card, Empty, ErrorNote, PageHeader, RealChip, Skeleton } from "@/components/m/ui";

export default function ReceiptsPage() {
  const { me } = useSession();
  const live = useLive((s) => s.events.find((e) => e.type.startsWith("receipt"))?.id);
  const r = useApi<{ configured: boolean; reason: string | null; receipts: ReceiptDTO[] }>("/api/receipts", { deps: [live] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/receipts", { method: "POST" });
      await r.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receipt submission failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Economic Receipts"
        eyebrow={<RealChip />}
        description="Proof that the books weren't changed later. Every few minutes it takes a fingerprint of its income, AI costs and mood, and stores that fingerprint on the NEAR blockchain. No prompts or personal data are included."
        actions={
          me?.user ? (
            <Button variant="green" onClick={publish} loading={busy} disabled={!r.data?.configured}>Publish receipt now</Button>
          ) : (
            <ConnectWallet size="sm" label="Sign in to publish" />
          )
        }
      />
      {error && <div className="mb-4"><ErrorNote message={error} /></div>}
      {r.data && !r.data.configured && (
        <Empty title="On-chain receipts are not configured" className="mb-4">
          {r.data.reason}. Deploy <span className="font-mono">contracts/metabolic</span> to testnet and set <span className="font-mono">NEAR_CONTRACT_ID</span>, <span className="font-mono">NEAR_RECEIPT_SIGNER_ID</span> and <span className="font-mono">NEAR_RECEIPT_SIGNER_KEY</span>.
        </Empty>
      )}
      <Card className="mb-4 p-5 text-[13.5px] text-ink-2">
        <b className="text-ink">What a receipt proves.</b> That these aggregate numbers were committed at this time and have not changed since — anyone can recompute the hash on the{" "}
        <Link href="/verify" className="font-semibold text-g-700 hover:underline">verify page</Link>. It does not prove an AI provider was paid; provider costs come from usage records.
      </Card>
      {r.loading ? (
        <Skeleton className="h-40" />
      ) : r.data?.receipts.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {r.data.receipts.map((x) => (
            <ReceiptCard key={x.id} r={x} />
          ))}
        </div>
      ) : (
        <Empty title="No receipts yet">The worker commits one every few minutes when there is activity. You can also publish one now.</Empty>
      )}
    </div>
  );
}
