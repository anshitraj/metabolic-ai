"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { OperatingState, Tier } from "@/lib/economics/types";
import { api, streamNdjson } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { useLive } from "@/lib/client/live";
import { useApi } from "@/lib/client/use-api";
import { big, formatBp, formatUsd } from "@/lib/economics/money";
import { Markdown } from "@/components/m/markdown";
import { Button, ButtonLink, Card, EstChip, Label, Spinner, StateChip, TierBadge, cx } from "@/components/m/ui";

type Usage = {
  model: string;
  servedModel?: string;
  tier: Tier;
  inTokens: number;
  outTokens: number;
  cost: string;
  charge: string;
  marginBp: number | null;
  costIsEstimated: boolean;
  partial: boolean;
  latencyMs: number | null;
  explanation: string | null;
  state: OperatingState | null;
  spendPass?: { id: string; name: string; policyVersion: number } | null;
};
type Msg = { role: "user" | "assistant"; content: string; usage?: Usage | null; pending?: boolean; notice?: { kind: "switch" | "failover" | "error"; text: string; code?: string; needed?: string } };
type Quote = {
  state: OperatingState;
  ok: boolean;
  explanation: string;
  code: string | null;
  model: { id: string; label: string; tier: Tier; tierLabel: string } | null;
  estimate: { cost: string; charge: string; marginBp: number; inTokens: number; outTokens: number } | null;
  credits: { available: string; reserved: string } | null;
};

export default function WorkspacePage() {
  const { me, loading, refresh } = useSession();
  const overview = useLive((s) => s.overview);
  const convs = useApi<{ conversations: { id: string; title: string; updatedAt: string }[] }>(me?.user ? "/api/chat/conversations" : null);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState({ n: 0, charge: 0n });

  // Load a conversation.
  const open = useCallback(async (id: string | null) => {
    setConvId(id);
    if (!id) return setMessages([]);
    const c = await api<{ messages: { role: "user" | "assistant"; content: string; usage: (Usage & { usageId: string }) | null }[] }>(`/api/chat/conversations/${id}`);
    setMessages(c.messages.map((m) => ({ role: m.role, content: m.content, usage: m.usage })));
  }, []);

  // Live quote as the user types.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const historyChars = messages.reduce((n, m) => n + m.content.length, 0);
        setQuote(await api<Quote>("/api/chat/quote", { method: "POST", json: { prompt: input || " ", historyChars } }));
      } catch {
        /* quote is best-effort */
      }
    }, 350);
    return () => clearTimeout(t);
  }, [input, messages, overview?.state]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "", pending: true }]);
    const patchLast = (f: (m: Msg) => Msg) => setMessages((ms) => [...ms.slice(0, -1), f(ms[ms.length - 1])]);
    const insertNotice = (n: Msg["notice"]) => setMessages((ms) => [...ms.slice(0, -1), { role: "assistant", content: "", notice: n }, ms[ms.length - 1]]);
    try {
      await streamNdjson<Record<string, unknown> & { type: string }>(
        "/api/chat",
        { conversationId: convId, message: text, idempotencyKey: crypto.randomUUID() },
        (ev) => {
          if (ev.type === "conversation") setConvId(ev.id as string);
          if (ev.type === "meta") {
            const model = ev.model as { label: string; tier: Tier };
            if (ev.switched) insertNotice({ kind: "switch", text: `Switched to ${model.label} (${model.tier}). ${ev.explanation as string}` });
            useLive.getState().pushEffect({ type: "inference.started", payload: {} });
          }
          if (ev.type === "failover") insertNotice({ kind: "failover", text: `Provider failed (${ev.reason as string}); retried on ${String(ev.to).split(":").pop()}.` });
          if (ev.type === "text") patchLast((m) => ({ ...m, content: m.content + (ev.text as string) }));
          if (ev.type === "final") {
            const u = ev as unknown as Usage & { charge: string };
            patchLast((m) => ({ ...m, pending: false, usage: { ...u, explanation: ev.explanation as string, state: ev.state as OperatingState } }));
            setSession((s) => ({ n: s.n + 1, charge: s.charge + big(u.charge) }));
          }
          if (ev.type === "error") {
            patchLast((m) => ({ ...m, pending: false, notice: { kind: "error", text: ev.message as string, code: ev.code as string, needed: ev.needed as string | undefined } }));
          }
        },
        ac.signal,
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        patchLast((m) => ({ ...m, pending: false, notice: { kind: "error", text: e instanceof Error ? e.message : "Request failed." } }));
      } else patchLast((m) => ({ ...m, pending: false }));
    } finally {
      setBusy(false);
      abort.current = null;
      void refresh();
      void convs.reload();
    }
  };

  if (loading) return <div className="grid h-[60vh] place-items-center text-muted"><Spinner /></div>;

  if (!me?.user) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <div className="text-center">
          <h1 className="font-serif text-[34px] leading-10">Ask an AI that pays its own way.</h1>
          <p className="mx-auto mt-3 max-w-lg text-ink-2">Each answer shows which AI model replied, what it cost the business, what you paid, and why that model was picked.</p>
        </div>
        <ol className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            ["Sign in", "Connect a NEAR wallet and sign a message. Free, no transaction."],
            ["Add credit", "Deposit a little testnet NEAR on the Treasury page."],
            ["Ask anything", "You see the estimated price before you send."],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-xl border border-line bg-surface p-4">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-g-700 text-[12px] font-bold text-white">{i + 1}</span>
              <div className="mt-2 text-[14.5px] font-semibold">{t}</div>
              <p className="mt-1 text-[13px] leading-5 text-ink-2">{d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/login?next=/console/workspace" variant="green" size="lg">Sign in to start</ButtonLink>
          <ButtonLink href="/demo" variant="secondary" size="lg">Watch the demo first</ButtonLink>
        </div>
      </div>
    );
  }

  const credits = big(me.credits?.available);
  const lowCredit = quote?.estimate ? credits < big(quote.estimate.charge) : credits <= 0n;

  return (
    <div className="grid h-[calc(100dvh-56px-48px)] min-h-[560px] gap-4 lg:grid-cols-[220px_1fr_260px]">
      {/* Conversations */}
      <Card className="hidden flex-col overflow-hidden lg:flex">
        <div className="border-b border-line p-3">
          <Button size="sm" variant="secondary" className="w-full" onClick={() => void open(null)}>+ New conversation</Button>
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {(convs.data?.conversations ?? []).map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => void open(c.id)} className={cx("w-full truncate rounded-md px-2 py-1.5 text-left text-[13px]", c.id === convId ? "bg-g-50 font-semibold text-g-900" : "text-ink-2 hover:bg-paper-sunken")}>
                {c.title}
              </button>
            </li>
          ))}
          {convs.data && convs.data.conversations.length === 0 && <li className="px-2 py-2 text-[12.5px] text-muted">No conversations yet.</li>}
        </ul>
      </Card>

      {/* Thread */}
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-[12.5px]">
          {overview && <StateChip state={overview.state} />}
          <span className="text-muted">Auto routing · operator-funded AI providers</span>
          <span className="ml-auto text-muted">Credits <b className="m-num text-ink">{formatUsd(credits)}</b></span>
        </div>
        <div ref={scroller} className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite">
          {messages.length === 0 && (
            <div className="mx-auto max-w-md py-10 text-center">
              <h2 className="font-serif text-[26px] leading-8">What should we think about?</h2>
              <p className="mt-2 text-[13.5px] text-ink-2">The router prices every capable model before answering and picks the best one the business can afford right now.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {["Explain NEAR's account model in 3 bullets", "Write a haiku about operating margins", "What is a liquidity reserve?"].map((s) => (
                  <button key={s} type="button" onClick={() => setInput(s)} className="rounded-full border border-line bg-paper px-3 py-1 text-[12.5px] text-ink-2 hover:border-line-strong hover:text-ink">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                {m.notice && <Notice n={m.notice} />}
                {m.role === "user" ? (
                  <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[14.5px] text-white">{m.content}</div>
                ) : m.content || m.pending ? (
                  <div className="max-w-[92%]">
                    <div className="text-[14.5px] leading-[1.7] text-ink">
                      {m.content ? <Markdown text={m.content} /> : <span className="inline-flex items-center gap-2 text-muted"><Spinner size={14} /> pricing models and thinking…</span>}
                    </div>
                    {m.usage && <CostFooter u={m.usage} />}
                  </div>
                ) : null}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div className="border-t border-line p-3">
          {lowCredit && (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-df-tint px-3 py-2 text-[13px] text-df-text">
              <span>{credits <= 0n ? "You have no prepaid credit." : "Your credit may not cover this request."} Deposit testnet NEAR to continue.</span>
              <ButtonLink href="/console/treasury?deposit=credits" size="sm" variant="ink">Add credit</ButtonLink>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="Ask anything…"
              aria-label="Message"
              className="max-h-40 min-h-[48px] flex-1 resize-none rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-[14.5px] outline-none focus:border-g-500 focus:ring-2 focus:ring-g-500/20"
            />
            {busy ? (
              <Button type="button" variant="secondary" onClick={() => abort.current?.abort()}>Stop</Button>
            ) : (
              <Button type="submit" variant="green" disabled={!input.trim() || (quote ? !quote.ok : false)}>Send</Button>
            )}
          </form>
          <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[12px] text-muted">
            <span>
              {quote?.ok && quote.estimate ? (
                <>
                  est. <span className="m-num">{formatUsd(big(quote.estimate.charge))}</span> on <b className="text-ink-2">{quote.model?.label}</b>
                </>
              ) : quote && !quote.ok ? (
                <span className="text-sv-text">{quote.explanation}</span>
              ) : (
                "Estimating…"
              )}
            </span>
            <span>Enter to send · Shift+Enter for a new line</span>
          </div>
        </div>
      </Card>

      {/* Request panel */}
      <div className="hidden flex-col gap-4 lg:flex">
        <Card className="p-4">
          <Label>This request</Label>
          {quote?.ok && quote.estimate && quote.model ? (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[13px]">
              <dt className="text-muted">Model</dt>
              <dd className="text-right">{quote.model.label}</dd>
              <dt className="text-muted">Tier</dt>
              <dd className="text-right"><TierBadge tier={quote.model.tier} /></dd>
              <dt className="text-muted">Est. cost</dt>
              <dd className="text-right m-num">{formatUsd(big(quote.estimate.cost))}<EstChip /></dd>
              <dt className="text-muted">You pay</dt>
              <dd className="text-right m-num">{formatUsd(big(quote.estimate.charge))}<EstChip /></dd>
              <dt className="text-muted">Margin</dt>
              <dd className="text-right m-num">{formatBp(quote.estimate.marginBp)}</dd>
            </dl>
          ) : (
            <p className="mt-3 text-[13px] text-ink-2">{quote?.explanation ?? "Estimating…"}</p>
          )}
          {quote?.ok && <p className="mt-3 text-[12px] leading-[18px] text-muted">{quote.explanation}</p>}
        </Card>
        <Card className="p-4">
          <Label>This session</Label>
          <div className="mt-3 flex justify-between text-[13px]">
            <span className="text-muted">Requests</span>
            <span className="m-num">{session.n}</span>
          </div>
          <div className="mt-1 flex justify-between text-[13px]">
            <span className="text-muted">Charged</span>
            <span className="m-num">{formatUsd(session.charge)}</span>
          </div>
          <Link href="/console/decisions" className="mt-3 block text-[12.5px] font-semibold text-g-700 hover:underline">See every routing decision →</Link>
        </Card>
      </div>
    </div>
  );
}

function Notice({ n }: { n: NonNullable<Msg["notice"]> }) {
  const cls = n.kind === "error" ? "border-sv/30 bg-sv-tint text-sv-text" : n.kind === "failover" ? "border-df/30 bg-df-tint text-df-text" : "border-g-200 bg-g-50 text-g-900";
  return (
    <div role={n.kind === "error" ? "alert" : "status"} className={cx("mb-3 rounded-lg border px-3 py-2 text-[13px]", cls)}>
      {n.kind === "switch" && <b className="font-semibold">Model switch · </b>}
      {n.text}
      {n.code === "INSUFFICIENT_CREDITS" && (
        <>
          {n.needed && <> You need about {formatUsd(big(n.needed))} more.</>} <Link href="/console/treasury?deposit=credits" className="font-semibold underline">Add credit</Link>
        </>
      )}
      {n.code === "FUNDING_REQUIRED" && (
        <> The business protects its reserve in Survival. <Link href="/console/treasury?deposit=capital" className="font-semibold underline">Fund it</Link></>
      )}
    </div>
  );
}

function CostFooter({ u }: { u: Usage }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-line bg-paper px-3 py-2 text-[12px] text-ink-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left" aria-expanded={open}>
        <span className="font-mono text-ink">{(u.servedModel ?? u.model).split(":").pop()}</span>
        <TierBadge tier={u.tier} />
        <span className="m-num">{u.inTokens} in / {u.outTokens} out</span>
        <span>cost <span className="m-num">{formatUsd(big(u.cost))}</span>{u.costIsEstimated && <EstChip />}</span>
        <span>paid <span className="m-num">{formatUsd(big(u.charge))}</span></span>
        <span>margin <span className="m-num">{formatBp(u.marginBp)}</span></span>
        {u.partial && <span className="text-df-text">partial</span>}
        <span className="ml-auto text-muted">{open ? "less" : "why?"}</span>
      </button>
      {open && (
        <div className="mt-2 border-t border-line pt-2 leading-5">
          {u.explanation}
          {u.costIsEstimated && <div className="mt-1 text-df-text">The provider did not report token usage, so the cost and token counts are estimated.</div>}
          {u.latencyMs !== null && <div className="mt-1 font-mono text-muted">{u.latencyMs} ms</div>}
        </div>
      )}
    </div>
  );
}
