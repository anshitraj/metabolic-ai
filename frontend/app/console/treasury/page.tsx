"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/client/session";
import { useLive } from "@/lib/client/live";
import { useApi } from "@/lib/client/use-api";
import { api, ApiError } from "@/lib/client/api";
import { big, formatCoverage, formatNear, formatRunway, formatUsd, nearToUsd, parseNear } from "@/lib/economics/money";
import { ConnectWallet } from "@/components/m/wallet";
import { Hint } from "@/components/m/guide";
import { ClaimForm, useSetup } from "@/components/m/journey";
import { Badge, Button, Card, Dialog, Empty, Field, Hash, Label, Money, Near, PageHeader, RealChip, Skeleton, TimeAgo, cx, inputClass } from "@/components/m/ui";
import type { DepositIntent } from "@/lib/client/near";
import { IntentsPay } from "@/components/m/intents-pay";

type TreasuryDTO = {
  network: string;
  target: { receiverId: string; method: "deposit" | "transfer" } | null;
  onChain: { amountYocto: string; lockedYocto: string; storageUsage: number } | null;
  recordedYocto: { capital: string; credits: string };
  depositors: number;
  transactions: { hash: string; kind: string; signer: string; receiver: string; amountYocto: string; status: string; at: string; usd: string | null; depositKind: string | null; explorer: string }[];
  myDeposits: { hash: string; amountYocto: string; usd: string; at: string; kind: string; explorer: string }[];
  balance: { available: bigint | string; reserved: bigint | string } | null;
};

export default function TreasuryPage() {
  const { me, config, refresh } = useSession();
  const overview = useLive((s) => s.overview);
  const events = useLive((s) => s.events);
  const t = useApi<TreasuryDTO>("/api/treasury", { deps: [events.find((e) => e.type === "treasury.deposit.confirmed")?.id, me?.user?.id] });
  const [open, setOpen] = useState(false);
  const [resume, setResume] = useState<string | null>(null);
  const setup = useSetup();
  const [purposeParam, setPurposeParam] = useState<"capital" | "credits" | undefined>(undefined);

  // A redirect-based wallet returns ?transactionHashes=… — verify it.
  useEffect(() => {
    void (async () => {
      const { takeRedirectTxHash } = await import("@/lib/client/near");
      const h = takeRedirectTxHash();
      if (h) {
        setResume(h);
        setOpen(true);
      } else if (new URLSearchParams(window.location.search).get("deposit")) {
        const p = new URLSearchParams(window.location.search).get("deposit");
        if (p === "credits" || p === "capital") setPurposeParam(p);
        setOpen(true);
      }
    })();
  }, []);

  const d = t.data;
  return (
    <div>
      <PageHeader
        title="Treasury"
        eyebrow={<RealChip />}
        description="The business's bank account. See what it holds, how much of that belongs to customers as unused credit, and what is really its own to spend. Deposits count only after we confirm them on the NEAR blockchain."
        actions={
          me?.user ? (
            <Button variant="green" onClick={() => setOpen(true)} disabled={!d?.target}>
              {me.user.role === "operator" ? "Deposit NEAR" : "Add credit"}
            </Button>
          ) : (
            <ConnectWallet />
          )
        }
      />

      {!d && t.loading && <Skeleton className="h-40" />}
      {d && !d.target && (
        <Empty title={setup.data?.canClaim ? "One step before deposits work" : "Deposits aren't set up yet"} className="mb-4">
          {setup.data?.canClaim && me?.user ? (
            <>
              This business has no operator yet. Become its operator and choose the NEAR account that will hold its money — then deposits work straight away.
              <ClaimForm accountId={me.user.accountId} onDone={() => { void setup.reload(); void refresh(); void t.reload(); }} />
            </>
          ) : !me?.user ? (
            <>Sign in first. The first person to sign in becomes the operator and chooses the treasury account.</>
          ) : (
            <>The operator hasn&apos;t chosen a treasury account yet. Once they do, you can deposit here.</>
          )}
        </Empty>
      )}

      {overview && (
        <Card className="mb-4 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">Where the money is <Hint term="liquidity" /></h2>
            {d?.target && (
              <span className="text-[12.5px] text-muted">
                {d.target.method === "deposit" ? "Contract" : "Treasury account"} <Hash value={d.target.receiverId} href={`${config?.explorerUrl ?? ""}/address/${d.target.receiverId}`} chars={14} />
              </span>
            )}
          </div>
          <Breakdown o={overview} />
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <Label className="flex items-center gap-1.5">Your credits <Hint term="credits" /></Label>
          {me?.user ? (
            <>
              <div className="mt-2 text-[24px] font-medium"><Money micro={me.credits?.available ?? "0"} /></div>
              <div className="font-mono text-[12px] text-muted">{formatUsd(big(me.credits?.reserved))} reserved for in-flight requests</div>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-ink-2">Sign in to see your prepaid balance.</p>
          )}
        </Card>
        <Card className="p-4">
          <Label className="flex items-center gap-1.5">Revenue recognised <Hint term="revenue" /></Label>
          <div className="mt-2 text-[24px] font-medium"><Money micro={overview?.revenueTotal} /></div>
          <div className="font-mono text-[12px] text-muted">from consumed credits only</div>
        </Card>
        <Card className="p-4">
          <Label className="flex items-center gap-1.5">Provider expenses <Hint term="spend" /></Label>
          <div className="mt-2 text-[24px] font-medium"><Money micro={overview?.expenseTotal} /></div>
          <div className="font-mono text-[12px] text-muted">
            {overview && big(overview.expenseEstimatedTotal) > 0n ? `${formatUsd(big(overview.expenseEstimatedTotal))} estimated` : "all from provider-reported usage"}
          </div>
        </Card>
        <Card className="p-4">
          <Label className="flex items-center gap-1.5">Runway <Hint term="runway" /></Label>
          <div className="mt-2 text-[24px] font-medium m-num">{overview ? formatRunway(overview.runwaySeconds) : "—"}</div>
          <div className="font-mono text-[12px] text-muted">{overview ? `${formatCoverage(overview.reserveCoverageBp)} of hard reserve` : ""}</div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-[15px] font-semibold">On-chain transactions</h2>
            <span className="text-[12px] text-muted">{d?.network}</span>
          </div>
          {d?.transactions.length ? (
            <>
            <div className="divide-y divide-line px-4 md:hidden">{d.transactions.map((x) => <div key={x.hash} className="py-4"><div className="flex items-center justify-between gap-3"><Badge tone={x.kind === "receipt" ? "blue" : x.depositKind === "capital" ? "neutral" : "green"}>{x.kind === "receipt" ? "Receipt" : x.depositKind === "capital" ? "Capital" : "Credits"}</Badge><span className="text-[11px] text-muted"><TimeAgo iso={x.at} /></span></div><div className="my-3 flex items-center justify-between gap-2"><strong className="m-num text-[17px]">{x.kind === "receipt" ? "Accounting commitment" : formatNear(big(x.amountYocto), 3)}</strong><Badge tone={x.status === "final" ? "green" : x.status === "failed" ? "red" : "amber"}>{x.status === "final" ? "Finalized" : x.status}</Badge></div><div className="mb-2 break-all font-mono text-[11px] text-muted">From {x.signer}</div><Hash value={x.hash} href={x.explorer} chars={9} /></div>)}</div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-paper-sunken text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-5 py-2 font-semibold">When</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Amount</th>
                    <th className="px-3 py-2 font-semibold">From</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-5 py-2 font-semibold">Transaction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.transactions.map((x) => (
                    <tr key={x.hash}>
                      <td className="px-5 py-2.5 text-muted"><TimeAgo iso={x.at} /></td>
                      <td className="px-3 py-2.5">
                        <Badge tone={x.kind === "receipt" ? "blue" : x.depositKind === "capital" ? "neutral" : "green"}>{x.kind === "receipt" ? "Receipt" : x.depositKind === "capital" ? "Capital" : "Credits"}</Badge>
                      </td>
                      <td className="px-3 py-2.5 m-num">{x.kind === "receipt" ? "—" : <>{formatNear(big(x.amountYocto), 3)}{x.usd && <span className="text-muted"> · {formatUsd(big(x.usd))}</span>}</>}</td>
                      <td className="max-w-[160px] truncate px-3 py-2.5 font-mono text-[12px]">{x.signer}</td>
                      <td className="px-3 py-2.5"><Badge tone={x.status === "final" ? "green" : x.status === "failed" ? "red" : "amber"}>{x.status === "final" ? "Finalized" : x.status}</Badge></td>
                      <td className="px-5 py-2.5"><Hash value={x.hash} href={x.explorer} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          ) : (
            <p className="px-5 py-6 text-[13px] text-muted">No verified on-chain transactions yet.</p>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Reconciliation</h2>
          <dl className="mt-3 space-y-2 text-[13px]">
            <div className="flex justify-between"><dt className="text-ink-2">Account balance on chain</dt><dd><Near yocto={d?.onChain?.amountYocto} places={3} /></dd></div>
            <div className="flex justify-between"><dt className="text-ink-2">Recorded customer deposits</dt><dd><Near yocto={d?.recordedYocto.credits} places={3} /></dd></div>
            <div className="flex justify-between"><dt className="text-ink-2">Recorded operating capital</dt><dd><Near yocto={d?.recordedYocto.capital} places={3} /></dd></div>
            <div className="flex justify-between"><dt className="text-ink-2">Depositors</dt><dd className="m-num">{d?.depositors ?? "—"}</dd></div>
          </dl>
          <p className="mt-3 text-[12px] leading-[18px] text-muted">
            The on-chain balance also includes the account&apos;s own storage stake and any funds sent outside this app, so it is shown next to — never in place of — the ledger. Customer deposits are a liability until consumed. NEAR proves deposits and receipt commitments; provider bills are proven by usage records.
          </p>
        </Card>
      </div>

      <IntentsPay signedIn={!!me?.user} onCredited={() => void refresh()} />

      {me?.user && (
        <DepositDialog
          key={purposeParam ?? "default"}
          open={open}
          onClose={() => {
            setOpen(false);
            setResume(null);
          }}
          network={config?.network ?? "testnet"}
          operator={me.user.role === "operator"}
          initialPurpose={purposeParam}
          resumeHash={resume}
          onDone={() => {
            void refresh();
            void t.reload();
          }}
          rate={overview?.rate ?? null}
        />
      )}
    </div>
  );
}

function Breakdown({ o }: { o: NonNullable<ReturnType<typeof useLive.getState>["overview"]> }) {
  const treasury = Number(big(o.treasury));
  const parts = [
    { k: "Customer credits", v: Number(big(o.liabilities)), cls: "bg-[#c9c8bd]" },
    { k: "Provider payables", v: Number(big(o.payables)), cls: "bg-df" },
    { k: "Hard reserve", v: Math.min(Number(big(o.hardReserve)), Math.max(0, Number(big(o.liquidity)))), cls: "bg-sv/70" },
    { k: "Spendable", v: Number(big(o.spendable)), cls: "bg-g-500" },
  ];
  const total = Math.max(treasury, parts.reduce((n, p) => n + p.v, 0), 1);
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-paper-sunken" role="img" aria-label="Treasury breakdown">
        {parts.map((p) => (p.v > 0 ? <div key={p.k} className={cx("h-full border-r-2 border-surface last:border-r-0", p.cls)} style={{ width: `${(p.v / total) * 100}%` }} title={`${p.k}: ${formatUsd(BigInt(Math.round(p.v)))}`} /> : null))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div>
          <div className="text-[12px] text-muted">Treasury</div>
          <div className="m-num text-[15px] font-semibold">{formatUsd(big(o.treasury))}</div>
        </div>
        {parts.map((p) => (
          <div key={p.k}>
            <div className="flex items-center gap-1.5 text-[12px] text-muted"><span className={cx("h-2 w-2 rounded-sm", p.cls)} />{p.k}</div>
            <div className="m-num text-[15px] font-semibold">{p.k === "Spendable" ? "" : "−"}{formatUsd(BigInt(Math.round(p.v)))}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

type Step = "amount" | "signing" | "verifying" | "done" | "error";

function DepositDialog({ open, onClose, network, operator, initialPurpose, resumeHash, onDone, rate }: { open: boolean; onClose: () => void; network: string; operator: boolean; initialPurpose?: "capital" | "credits"; resumeHash: string | null; onDone: () => void; rate: { microPerNear: string; stale: boolean; observedAt: string } | null }) {
  const [amount, setAmount] = useState("1");
  const [purpose, setPurposeState] = useState<"capital" | "credits">(operator && initialPurpose !== "credits" ? "capital" : "credits");
  // Remember the choice across a wallet redirect.
  const setPurpose = (p: "capital" | "credits") => {
    setPurposeState(p);
    try {
      sessionStorage.setItem("metabolic:deposit-purpose", p);
    } catch {
      /* storage unavailable */
    }
  };
  const savedPurpose = (): "capital" | "credits" => {
    try {
      const p = sessionStorage.getItem("metabolic:deposit-purpose");
      if (p === "capital" || p === "credits") return p;
    } catch {
      /* storage unavailable */
    }
    return purpose;
  };
  const capital = operator && purpose === "capital";
  const [step, setStep] = useState<Step>("amount");
  const [hash, setHash] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ usd: string; amountYocto: string; explorer: string } | null>(null);

  const verify = async (h: string, attempt = 0) => {
    setHash(h);
    setStep("verifying");
    setError(null);
    try {
      const intentId = sessionStorage.getItem("metabolic:deposit-intent") ?? undefined;
      const r = await api<{ usd: string; amountYocto: string; explorer: string }>("/api/treasury/verify-deposit", { method: "POST", json: { txHash: h, intentId, purpose: operator ? (resumeHash === h ? savedPurpose() : purpose) : undefined } });
      sessionStorage.removeItem("metabolic:deposit-intent");
      setResult(r);
      setStep("done");
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.extra?.retryable && attempt < 6) {
        setTimeout(() => void verify(h, attempt + 1), 3000);
        return;
      }
      setError(e instanceof Error ? e.message : "Verification failed.");
      setStep("error");
    }
  };

  useEffect(() => {
    if (open && resumeHash) void verify(resumeHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resumeHash]);

  const start = async () => {
    setError(null);
    setStep("signing");
    try {
      const intent = await api<DepositIntent>("/api/treasury/deposit-intent", { method: "POST", json: { amountNear: amount, purpose: operator ? purpose : undefined } });
      if (operator) setPurpose(purpose);
      const { sendDeposit } = await import("@/lib/client/near");
      const h = await sendDeposit(network, intent);
      await verify(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The wallet did not complete the transaction.");
      setStep("error");
    }
  };

  const yocto = parseNear(amount);
  const est = yocto && rate && !rate.stale ? nearToUsd(yocto, big(rate.microPerNear)) : null;
  const steps: { k: Step; label: string }[] = [
    { k: "signing", label: "Sign in wallet" },
    { k: "verifying", label: "Verify finality on chain" },
    { k: "done", label: capital ? "Recorded as business capital" : "Credited to you" },
  ];
  const idx = step === "amount" ? -1 : step === "error" ? steps.findIndex((s) => s.k === (hash ? "verifying" : "signing")) : steps.findIndex((s) => s.k === step);

  return (
    <Dialog open={open} onClose={onClose} title={capital ? "Fund the business" : "Add credit"}>
      {step === "amount" ? (
        <div className="space-y-4">
          {operator && (
            <div role="radiogroup" aria-label="What is this deposit for?" className="grid grid-cols-2 gap-2">
              {(
                [
                  ["capital", "Fund the business", "Its own money. Wakes it up and keeps it running."],
                  ["credits", "Credit for me", "Your prepaid balance for asking questions."],
                ] as const
              ).map(([k, t, d]) => (
                <button key={k} type="button" role="radio" aria-checked={purpose === k} onClick={() => setPurpose(k)} className={cx("rounded-xl border p-3 text-left transition-colors", purpose === k ? "border-g-500 bg-g-50" : "border-line bg-surface hover:border-line-strong")}>
                  <div className="text-[13.5px] font-semibold text-ink">{t}</div>
                  <div className="mt-0.5 text-[12px] leading-4 text-ink-2">{d}</div>
                </button>
              ))}
            </div>
          )}
          <Field label="Amount (NEAR)" hint={est !== null ? <>≈ {formatUsd(est)} at ${(Number(big(rate!.microPerNear)) / 1e6).toFixed(3)}/NEAR (rate from {new Date(rate!.observedAt).toLocaleTimeString()})</> : "USD value is fixed when the server verifies the deposit. Rate currently unavailable."}>
            <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <p className="text-[12.5px] text-ink-2">
            {capital
              ? "This becomes the business's own money. It raises what it can spend and can bring it out of Survival."
              : "This becomes your prepaid credit. The business only counts it as income as you spend it on answers."}
          </p>
          <Button variant="green" className="w-full" onClick={start} disabled={!yocto || yocto <= 0n}>Continue in wallet</Button>
          <details className="text-[12.5px] text-muted">
            <summary className="cursor-pointer">Already sent it? Verify a transaction hash</summary>
            <div className="mt-2 flex gap-2">
              <input className={inputClass} placeholder="Transaction hash" value={manual} onChange={(e) => setManual(e.target.value.trim())} />
              <Button variant="secondary" onClick={() => void verify(manual)} disabled={manual.length < 40}>Verify</Button>
            </div>
          </details>
        </div>
      ) : (
        <div className="space-y-4">
          <ol className="space-y-2.5">
            {steps.map((s, i) => (
              <li key={s.k} className="flex items-center gap-3 text-[13.5px]">
                <span className={cx("grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold", i < idx || step === "done" ? "bg-g-700 text-white" : i === idx ? (step === "error" ? "bg-sv-text text-white" : "bg-g-50 text-g-700 ring-2 ring-g-500") : "bg-paper-sunken text-muted")}>
                  {i < idx || step === "done" ? "✓" : i + 1}
                </span>
                {s.label}
                {i === idx && step !== "done" && step !== "error" && <span className="text-muted">…</span>}
              </li>
            ))}
          </ol>
          {hash && (
            <div className="text-[12.5px] text-muted">
              Transaction <Hash value={hash} href={`https://${network === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${hash}`} />
            </div>
          )}
          {step === "done" && result && (
            <div className="rounded-lg bg-g-50 p-3 text-[13.5px] text-g-900">
              Deposit confirmed on NEAR {network}. {formatNear(big(result.amountYocto), 3)} → {formatUsd(big(result.usd))} {capital ? "business capital" : "credit for you"}.
            </div>
          )}
          {step === "error" && error && <div role="alert" className="rounded-lg bg-sv-tint p-3 text-[13px] text-sv-text">{error}</div>}
          <div className="flex gap-2">
            {(step === "done" || step === "error") && <Button variant="secondary" onClick={() => setStep("amount")}>New deposit</Button>}
            {step === "error" && hash && <Button variant="ink" onClick={() => void verify(hash)}>Retry verification</Button>}
            <Button variant="ghost" onClick={onClose} className="ml-auto">Close</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
