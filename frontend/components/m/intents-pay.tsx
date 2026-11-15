"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useApi } from "@/lib/client/use-api";
import { big, formatUsd } from "@/lib/economics/money";
import { Badge, Button, Card, Field, Hash, Money, TimeAgo, cx, inputClass } from "@/components/m/ui";

// Pay with any token through NEAR Intents (1Click API). Mainnet only: NEAR
// Intents has no testnet, so this moves real funds and says so plainly.

type Token = { assetId: string; symbol: string; chain: string; decimals: number; priceUsd: string };
type IntentsConfig = { enabled: boolean; reason: string | null; recipient: string | null; minUsd: string; maxUsd: string; authenticated: boolean; tokens: Token[] };
type Payment = {
  id: string;
  status: string;
  origin: { assetId: string; symbol: string; chain: string };
  amountInFormatted: string;
  depositAddress: string;
  depositMemo: string | null;
  quotedUsd: string;
  creditedUsd: string | null;
  creditedAt: string | null;
  deadline: string;
  createdAt: string;
  explorer: string;
  timeEstimateSeconds?: number;
};

const FEATURED = ["USDC", "USDT", "ETH", "BTC", "SOL", "wNEAR"];

const STATUS: Record<string, { label: string; tone: "neutral" | "green" | "amber" | "red" | "blue" }> = {
  PENDING_DEPOSIT: { label: "Waiting for your deposit", tone: "amber" },
  KNOWN_DEPOSIT_TX: { label: "Deposit seen", tone: "blue" },
  INCOMPLETE_DEPOSIT: { label: "Deposit too small", tone: "red" },
  PROCESSING: { label: "Solvers swapping", tone: "blue" },
  SUCCESS: { label: "Settled · credited", tone: "green" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  FAILED: { label: "Failed", tone: "red" },
};

const STEPS = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];

export function IntentsPay({ signedIn, onCredited }: { signedIn: boolean; onCredited?: () => void }) {
  const cfg = useApi<IntentsConfig>("/api/intents/tokens");
  const history = useApi<{ payments: Payment[] }>(signedIn ? "/api/intents/payments" : null);
  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<Payment | null>(null);
  const [txHash, setTxHash] = useState("");

  const tokens = useMemo(() => {
    const list = cfg.data?.tokens ?? [];
    const featured = list.filter((t) => FEATURED.includes(t.symbol)).sort((a, b) => FEATURED.indexOf(a.symbol) - FEATURED.indexOf(b.symbol) || a.chain.localeCompare(b.chain));
    return { featured, rest: list.filter((t) => !FEATURED.includes(t.symbol)) };
  }, [cfg.data]);
  const token = cfg.data?.tokens.find((t) => t.assetId === assetId) ?? null;
  const estimate = token && Number(amount) > 0 ? Number(amount) * Number(token.priceUsd) : null;

  // Poll the open payment until it settles, refunds or fails.
  useEffect(() => {
    if (!active || ["SUCCESS", "REFUNDED", "FAILED"].includes(active.status)) return;
    const t = setInterval(async () => {
      try {
        const p = await api<Payment>(`/api/intents/payments/${active.id}`);
        setActive((cur) => (cur && cur.id === p.id ? { ...cur, ...p } : cur));
        if (p.creditedAt) {
          onCredited?.();
          void history.reload();
        }
      } catch { /* keep polling */ }
    }, 6000);
    return () => clearInterval(t);
  }, [active, history, onCredited]);

  async function submitTx() {
    if (!active) return;
    setBusy(true);
    setErr(null);
    try {
      const p = await api<Payment>(`/api/intents/payments/${active.id}/deposit-tx`, { method: "POST", json: { txHash: txHash.trim() } });
      setActive((cur) => (cur ? { ...cur, ...p } : cur));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not submit the transaction.");
    } finally {
      setBusy(false);
    }
  }

  async function quote() {
    setBusy(true);
    setErr(null);
    try {
      const p = await api<Payment>("/api/intents/payments", { method: "POST", json: { originAsset: assetId, amount: amount.trim(), refundTo: refundTo.trim() } });
      setActive(p);
      void history.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not get a quote.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <div>
          <h2 className="text-[15px] font-semibold">Pay with any token · NEAR Intents</h2>
          <p className="text-[12.5px] text-muted">Send USDC, ETH, BTC, SOL or 200+ other tokens from their own chain. Solvers swap it and the business receives USDC on NEAR.</p>
        </div>
        <Badge tone="red">Mainnet · real funds</Badge>
      </div>

      {!cfg.data && cfg.loading && <p className="px-5 py-6 text-[13px] text-muted">Loading supported tokens…</p>}
      {cfg.data && !cfg.data.enabled && (
        <p className="px-5 py-6 text-[13px] text-ink-2">Not switched on for this deployment. {cfg.data.reason}</p>
      )}

      {cfg.data?.enabled && !active && (
        <div className="grid gap-4 p-5 md:grid-cols-3">
          <Field label="Token and chain">
            <select className={inputClass} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">Choose a token…</option>
              <optgroup label="Popular">
                {tokens.featured.map((t) => <option key={t.assetId} value={t.assetId}>{t.symbol} on {t.chain}</option>)}
              </optgroup>
              <optgroup label="All tokens">
                {tokens.rest.map((t) => <option key={t.assetId} value={t.assetId}>{t.symbol} on {t.chain}</option>)}
              </optgroup>
            </select>
          </Field>
          <Field label="Amount" hint={estimate !== null ? `≈ $${estimate.toFixed(2)} before swap fees` : `Between ${formatUsd(big(cfg.data.minUsd))} and ${formatUsd(big(cfg.data.maxUsd))}`}>
            <input className={inputClass} inputMode="decimal" placeholder={token ? `0.00 ${token.symbol}` : "0.00"} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={`Refund address${token ? ` on ${token.chain}` : ""}`} hint="Where your tokens go back if the swap can't complete.">
            <input className={cx(inputClass, "font-mono")} placeholder={token?.chain === "near" ? "you.near" : "0x… / bc1… / your address"} value={refundTo} onChange={(e) => setRefundTo(e.target.value)} />
          </Field>
          <div className="md:col-span-3 flex flex-wrap items-center gap-3">
            <Button variant="green" onClick={quote} loading={busy} disabled={!signedIn || !assetId || !amount || !refundTo}>Get deposit address</Button>
            {!signedIn && <span className="text-[12.5px] text-muted">Sign in first so the credit lands on your account.</span>}
            {err && <span className="text-[12.5px] text-sv-text">{err}</span>}
          </div>
        </div>
      )}

      {active && (
        <div className="p-5">
          <ol className="mb-5 grid grid-cols-4 gap-2" aria-label="Payment progress">
            {STEPS.map((s, i) => {
              const at = STEPS.indexOf(active.status);
              const done = at >= i || active.status === "SUCCESS";
              return (
                <li key={s} className="flex flex-col gap-1.5">
                  <span className={cx("h-1.5 rounded-full transition-colors duration-700", done ? "bg-g-500" : "bg-line", at === i && active.status !== "SUCCESS" && "animate-pulse")} />
                  <span className={cx("text-[11.5px]", done ? "text-ink" : "text-muted")}>{["Send", "Seen", "Swap", "Credited"][i]}</span>
                </li>
              );
            })}
          </ol>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 text-[13.5px]">
              <p>
                Send exactly <strong className="m-num">{active.amountInFormatted} {active.origin.symbol}</strong> on <strong>{active.origin.chain}</strong> to:
              </p>
              <div className="break-all rounded-lg border border-line bg-paper-sunken p-3 font-mono text-[13px]">
                <Hash value={active.depositAddress} chars={60} />
              </div>
              {active.depositMemo && <p>Memo (required): <span className="font-mono">{active.depositMemo}</span></p>}
              <p className="text-[12.5px] text-muted">
                Send before <time dateTime={active.deadline}>{new Date(active.deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>. If the swap can&apos;t complete by then, NEAR Intents refunds your refund address automatically.
              </p>
            </div>
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between"><dt className="text-ink-2">Status</dt><dd><Badge tone={STATUS[active.status]?.tone ?? "neutral"}>{STATUS[active.status]?.label ?? active.status}</Badge></dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Guaranteed credit</dt><dd><Money micro={active.quotedUsd} precise /></dd></div>
              {active.creditedUsd && <div className="flex justify-between"><dt className="text-ink-2">Credited</dt><dd><Money micro={active.creditedUsd} precise /></dd></div>}
              <div className="flex justify-between"><dt className="text-ink-2">Settles to</dt><dd className="font-mono text-[12px]">USDC · {cfg.data?.recipient}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Track it</dt><dd><a className="underline" href={active.explorer} target="_blank" rel="noreferrer">NEAR Intents explorer</a></dd></div>
            </dl>
          </div>
          {active.status === "PENDING_DEPOSIT" && (
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <Field label="Sent it? Paste the transaction hash (optional)" hint="Helps NEAR Intents spot your deposit sooner. It is detected without this too.">
                <input className={cx(inputClass, "font-mono sm:w-[420px]")} value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="0x… / transaction id" />
              </Field>
              <Button variant="secondary" loading={busy} disabled={txHash.trim().length < 16} onClick={submitTx}>Submit</Button>
            </div>
          )}
          {err && <p className="mt-2 text-[12.5px] text-sv-text">{err}</p>}
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => { setActive(null); setErr(null); setTxHash(""); }}>{active.creditedAt ? "Make another payment" : "Back"}</Button>
        </div>
      )}

      {signedIn && !!history.data?.payments.length && (
        <div className="border-t border-line px-5 py-3">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Your Intents payments</h3>
          <ul className="divide-y divide-line text-[13px]">
            {history.data.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <button className="text-left underline decoration-line-strong" onClick={() => setActive(p)}>{p.amountInFormatted} {p.origin.symbol} on {p.origin.chain}</button>
                <span className="flex items-center gap-2"><Money micro={p.creditedUsd ?? p.quotedUsd} /><Badge tone={STATUS[p.status]?.tone ?? "neutral"}>{STATUS[p.status]?.label ?? p.status}</Badge><span className="text-muted"><TimeAgo iso={p.createdAt} /></span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
