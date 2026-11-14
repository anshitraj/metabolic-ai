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
        <ReceiptsSetup accountId={me?.user?.accountId ?? "your-account.testnet"} signedIn={!!me?.user} />
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
      ) : r.data?.configured ? (
        <Empty title="No receipts yet">The worker commits one every few minutes when there is activity. You can also publish one now.</Empty>
      ) : null}
    </div>
  );
}

/** Plain-language steps to switch receipts on. The script does the deploying; no NEAR CLI needed. */
function ReceiptsSetup({ accountId, signedIn }: { accountId: string; signedIn: boolean }) {
  const [copied, setCopied] = useState(false);
  const cmd = `pnpm setup:contract ${accountId}`;
  const steps: [string, React.ReactNode][] = [
    ["Build the contract once", <>In a terminal: <code className="font-mono text-[12.5px]">cd contracts/metabolic</code> then <code className="font-mono text-[12.5px]">cargo build --target wasm32-unknown-unknown --release</code>. Skip if you already did.</>],
    ["Export your wallet's private key", <>MyNearWallet → Settings → Security &amp; Recovery → Export private key. It stays on your machine: the script uses it for one transaction and never saves it.</>],
    ["Run the setup command", <>From the <code className="font-mono text-[12.5px]">frontend</code> folder. It creates <code className="font-mono text-[12.5px]">metabolic.{accountId}</code>, deploys the contract, and fills in <code className="font-mono text-[12.5px]">.env.local</code> for you.</>],
    ["Restart the app", <>Stop and start <code className="font-mono text-[12.5px]">pnpm dev</code>. This page then lets you press <b>Publish receipt now</b>.</>],
  ];
  return (
    <Card className="mb-4 overflow-hidden">
      <div className="border-b border-line bg-df-tint/60 px-5 py-4">
        <div className="text-[15px] font-semibold text-ink">One step left to turn receipts on</div>
        <p className="mt-0.5 max-w-3xl text-[13.5px] leading-5 text-ink-2">
          Receipts are written to a small contract on the NEAR blockchain, and that contract hasn&apos;t been created yet. It takes about two minutes and uses roughly 3 testnet NEAR (they stay in the contract as treasury).
        </p>
      </div>
      <ol className="divide-y divide-line">
        {steps.map(([t, d], i) => (
          <li key={t} className="flex gap-3 px-5 py-3.5">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-bold text-white">{i + 1}</span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-ink">{t}</div>
              <p className="mt-0.5 text-[13px] leading-5 text-ink-2">{d}</p>
              {i === 2 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-stage px-3 py-2">
                  <code className="font-mono text-[12.5px] text-stage-ink">{cmd}</code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(cmd).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                    className="ml-auto rounded-md bg-white/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-stage-ink hover:bg-white/16"
                  >
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t border-line bg-paper-sunken/50 px-5 py-3 text-[12.5px] leading-5 text-muted">
        {signedIn ? "" : "Sign in first so the command uses your account name. "}
        The app works fine without receipts; they only add public proof that its books weren&apos;t changed later. Prefer a manual route? See <span className="font-mono">contracts/metabolic/README.md</span>.
      </p>
    </Card>
  );
}
