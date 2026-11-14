"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { big, formatUsd } from "@/lib/economics/money";
import {
  AGENTS,
  MODEL_CHOICES,
  OPENAI_APPS,
  firstPrompt,
  mcpSnippet,
  openAiSnippets,
  type AgentClient,
  type AgentId,
} from "@/lib/client/agent-clients";
import { ConnectWallet } from "./wallet";
import { Button, ButtonLink, Card, ErrorNote, Spinner, cx, inputClass } from "./ui";

export function AgentLogo({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  return <Image src={`/connectors/${name}.svg`} alt="" width={size} height={size} unoptimized loading="eager" className={cx("shrink-0 object-contain", className)} />;
}

function mask(code: string, key: string | undefined): string {
  return key ? code.split(key).join(`${key.slice(0, 8)}••••••••${key.slice(-3)}`) : code;
}

function CodeBlock({ code, copyText, title, hidden, onToggle }: { code: string; copyText: string; title: string; hidden?: boolean; onToggle?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl bg-stage">
      <div className="flex items-center justify-between border-b border-stage-line px-4 py-2">
        <span className="font-mono text-[11.5px] text-stage-muted">{title}</span>
        <div className="flex items-center gap-1.5">
          {onToggle && (
            <button type="button" onClick={onToggle} className="rounded-md px-2 py-1 font-mono text-[11px] text-stage-muted hover:bg-white/8 hover:text-stage-ink">
              {hidden ? "Show key" : "Hide key"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(copyText).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="rounded-md bg-white/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-stage-ink hover:bg-white/16"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-5 text-stage-ink">{code}</pre>
    </div>
  );
}

type TestState = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; text: string } | { kind: "error"; text: string };

async function rpc(url: string, key: string, method: string, params?: unknown, id = 1) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data.result;
}

export function ConnectAgent() {
  const { me, loading } = useSession();
  const [origin, setOrigin] = useState("https://your-host");
  const [door, setDoor] = useState<"mcp" | "openai">("mcp");
  const [agentId, setAgentId] = useState<AgentId>("claude-code");
  const [secret, setSecret] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [oaLang, setOaLang] = useState<"curl" | "python" | "javascript">("curl");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the browser origin after mount
    setOrigin(window.location.origin);
  }, []);

  const key = secret ?? (/^mk_(live|test)_[A-Za-z0-9_-]{16,}$/.test(pasted.trim()) ? pasted.trim() : undefined);
  const mcpUrl = `${origin}/api/mcp`;
  const base = `${origin}/api/v1`;
  const agent = AGENTS.find((a) => a.id === agentId) as AgentClient;
  const snippet = useMemo(() => mcpSnippet(agentId, mcpUrl, key), [agentId, mcpUrl, key]);
  const openai = useMemo(() => openAiSnippets(base, key), [base, key]);
  const credits = big(me?.credits?.available);

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const r = await api<{ secret: string }>("/api/keys", { method: "POST", json: { name: door === "mcp" ? `${agent.name} connection` : "OpenAI-compatible app" } });
      setSecret(r.secret);
      setReveal(false);
      setTest({ kind: "idle" });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create a key.");
    } finally {
      setCreating(false);
    }
  };

  const runTest = async (withQuestion: boolean) => {
    if (!key) return;
    setTest({ kind: "busy" });
    try {
      if (door === "mcp") {
        const init = await rpc(mcpUrl, key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "metabolic-console-test", version: "1" } });
        const tools = await rpc(mcpUrl, key, "tools/list", {}, 2);
        const names = (tools.tools as { name: string }[]).map((t) => t.name).join(", ");
        if (!withQuestion) return setTest({ kind: "ok", text: `Connected to ${init.serverInfo.name}. Tools your agent will see: ${names}.` });
        const r = await rpc(mcpUrl, key, "tools/call", { name: "ask", arguments: { prompt: "Reply with exactly: connected", max_output_tokens: 32 } }, 3);
        const out = (r.content?.[0]?.text as string | undefined) ?? "";
        if (r.isError) return setTest({ kind: "error", text: out });
        setTest({ kind: "ok", text: `Answered: ${out.split("\n")[0]}` });
      } else {
        const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
        const data = await res.json().catch(() => null);
        if (!res.ok) return setTest({ kind: "error", text: data?.error?.message ?? `Request failed (${res.status})` });
        if (!withQuestion) return setTest({ kind: "ok", text: `Key accepted. Models: ${(data.data as { id: string }[]).map((m) => m.id).join(", ")}.` });
        const chat = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "metabolic-auto", max_tokens: 32, messages: [{ role: "user", content: "Reply with exactly: connected" }] }),
        });
        const c = await chat.json().catch(() => null);
        if (!chat.ok) return setTest({ kind: "error", text: c?.error?.message ?? `Request failed (${chat.status})` });
        setTest({ kind: "ok", text: `Answered: ${c.choices?.[0]?.message?.content ?? "(empty)"}` });
      }
    } catch (e) {
      setTest({ kind: "error", text: e instanceof Error ? e.message : "Test failed." });
    }
  };

  const shownCode = reveal || !key ? snippet.code : mask(snippet.code, key);
  const groups: AgentClient["group"][] = ["Coding agents", "Desktop & IDE"];

  return (
    <div className="space-y-5">
      {/* 1 · Key */}
      <Card className="p-5 sm:p-6">
        <StepHead n={1} title="Get a key for your agent" done={!!key} />
        {loading ? (
          <div className="mt-4"><Spinner /></div>
        ) : !me?.user ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="max-w-lg text-[13.5px] leading-6 text-ink-2">Your agent signs in with a key, and its questions are paid from your credit. Sign in with your NEAR wallet to create one.</p>
            <ConnectWallet />
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="max-w-2xl text-[13.5px] leading-6 text-ink-2">
              A key lets one agent ask questions on your behalf. Each answer is paid from your credit
              {" "}(<b className="m-num text-ink">{formatUsd(credits)}</b> now) and appears in <Link href="/console/decisions" className="font-semibold text-g-700 hover:underline">Decisions</Link>.
              {credits <= 0n && (
                <>
                  {" "}You have none yet — <Link href="/console/treasury?deposit=credits" className="font-semibold text-g-700 underline">add a little credit</Link> before your agent asks.
                </>
              )}
            </p>
            {secret ? (
              <div className="rounded-xl border border-g-200 bg-g-50/70 p-3 text-[13px] text-g-900">
                <b>Key created and filled into the setup below.</b> It is shown only here, only now. If you leave this page you&apos;ll need a new one.
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2 font-mono text-[12.5px] text-ink">
                  <span className="break-all">{reveal ? secret : `${secret.slice(0, 8)}••••••••••••••••${secret.slice(-3)}`}</span>
                  <button type="button" onClick={() => setReveal((v) => !v)} className="ml-auto text-[11.5px] font-sans font-semibold text-g-700 hover:underline">{reveal ? "Hide" : "Show"}</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <Button variant="green" onClick={create} loading={creating}>Create a key</Button>
                <span className="text-[12.5px] text-muted">or</span>
                <div className="min-w-[220px] flex-1">
                  <input className={cx(inputClass, "font-mono text-[12.5px]")} placeholder="Paste a key you already created (mk_test_…)" value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Existing API key" spellCheck={false} />
                </div>
              </div>
            )}
            {createError && <ErrorNote message={createError} />}
          </div>
        )}
      </Card>

      {/* 2 · Door + tool */}
      <Card className="p-5 sm:p-6">
        <StepHead n={2} title="Choose where you'll use it" />
        <div role="tablist" aria-label="Connection type" className="mt-4 inline-flex rounded-xl border border-line bg-paper-sunken p-1 text-[13.5px]">
          {(
            [
              ["mcp", "Agents & IDEs", "as a tool"],
              ["openai", "OpenAI-compatible apps", "as a model"],
            ] as const
          ).map(([k, t, s]) => (
            <button key={k} type="button" role="tab" aria-selected={door === k} onClick={() => { setDoor(k); setTest({ kind: "idle" }); }} className={cx("rounded-lg px-4 py-2 text-left transition-colors", door === k ? "bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(14,20,16,.08)]" : "text-ink-2 hover:text-ink")}>
              {t} <span className="hidden text-[12px] font-normal text-muted sm:inline">· {s}</span>
            </button>
          ))}
        </div>

        {door === "mcp" ? (
          <div className="mt-5">
            <p className="mb-4 max-w-2xl text-[13.5px] leading-6 text-ink-2">
              Your agent gets three tools: <b>ask</b> (get an answer routed to the best model the business can afford), <b>business_status</b> and <b>list_models</b>. Pick your tool:
            </p>
            {groups.map((g) => (
              <div key={g} className="mb-4">
                <div className="m-label mb-2 text-muted">{g}</div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                  {AGENTS.filter((a) => a.group === g).map((a) => {
                    const on = a.id === agentId;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => { setAgentId(a.id); setTest({ kind: "idle" }); }}
                        className={cx("group relative flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all", on ? "border-g-500 bg-g-50/70 shadow-[0_6px_18px_rgba(18,179,110,.14)]" : "border-line bg-surface hover:-translate-y-px hover:border-line-strong")}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-paper-sunken ring-1 ring-line"><AgentLogo name={a.logo} size={22} /></span>
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-semibold text-ink">{a.name}</span>
                          <span className="block truncate text-[11.5px] text-muted">{a.maker}</span>
                        </span>
                        {on && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-g-500" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="mt-1 flex items-start gap-3 rounded-xl border border-dashed border-line-strong bg-paper-sunken/50 p-3.5 text-[13px] leading-5 text-ink-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface ring-1 ring-line"><AgentLogo name="openai" size={18} /></span>
              <div>
                <b className="text-ink">ChatGPT (chatgpt.com)</b> can&apos;t be connected yet: its connector screen only supports sign-in flows, not API keys. To use OpenAI&apos;s tools today, connect <b>Codex</b> above or use the <button type="button" onClick={() => setDoor("openai")} className="font-semibold text-g-700 underline">OpenAI-compatible</button> option.
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5">
            <p className="mb-4 max-w-2xl text-[13.5px] leading-6 text-ink-2">
              Any app that lets you set a <b>custom OpenAI base URL</b> can use Metabolic AI as its model. The router picks the actual model, so the &ldquo;model&rdquo; name is just a mode:
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {OPENAI_APPS.map((a) => (
                <div key={a.name} className="flex items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-paper-sunken ring-1 ring-line"><AgentLogo name={a.logo} size={22} /></span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-ink">{a.name}</span>
                    <span className="block text-[11.5px] leading-4 text-muted">{a.where}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* 3 · Setup */}
      <Card className="p-5 sm:p-6">
        <StepHead n={3} title={door === "mcp" ? `Set up ${agent.name}` : "Use these settings"} />
        <AnimatePresence mode="wait">
          {door === "mcp" ? (
            <motion.div key={`mcp-${agentId}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }} className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-paper-sunken ring-1 ring-line"><AgentLogo name={agent.logo} size={26} /></span>
                <div>
                  <div className="text-[15px] font-semibold">{snippet.title}</div>
                  <div className="font-mono text-[12px] text-muted">{agent.where}</div>
                </div>
                {agent.docs && (
                  <a href={agent.docs} target="_blank" rel="noreferrer" className="ml-auto text-[12.5px] font-semibold text-g-700 hover:underline">{agent.name} docs ↗</a>
                )}
              </div>
              <CodeBlock title={mcpUrl} code={shownCode} copyText={snippet.code} hidden={key ? !reveal : undefined} onToggle={key ? () => setReveal((v) => !v) : undefined} />
              {snippet.note && <p className="text-[12.5px] leading-5 text-ink-2">{snippet.note}</p>}
              <div className="rounded-xl bg-g-50/70 p-3.5 text-[13px] leading-5 text-g-900">
                <b>Then try asking your agent:</b>
                <div className="mt-1 font-mono text-[12.5px]">“{firstPrompt()}”</div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="openai" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }} className="mt-4 space-y-4">
              <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-line bg-paper-sunken/50 p-4 text-[13px] sm:grid-cols-[130px_1fr]">
                <dt className="text-muted">Base URL</dt>
                <dd className="break-all font-mono text-[12.5px]">{base}</dd>
                <dt className="text-muted">API key</dt>
                <dd className="font-mono text-[12.5px]">{key ? (reveal ? key : `${key.slice(0, 8)}••••••••${key.slice(-3)}`) : <span className="font-sans text-muted">create or paste a key in step 1</span>}</dd>
                <dt className="text-muted">Model</dt>
                <dd>
                  <ul className="space-y-1">
                    {MODEL_CHOICES.map(([m, d]) => (
                      <li key={m}>
                        <code className="font-mono text-[12.5px] font-semibold text-ink">{m}</code> <span className="text-ink-2">— {d}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </dl>
              <div>
                <div className="mb-2 flex gap-1">
                  {openai.map((s) => (
                    <button key={s.id} type="button" onClick={() => setOaLang(s.id)} aria-pressed={oaLang === s.id} className={cx("rounded-lg px-3 py-1.5 text-[12.5px] font-semibold", oaLang === s.id ? "bg-ink text-white" : "text-ink-2 hover:bg-paper-sunken")}>{s.label}</button>
                  ))}
                </div>
                {(() => {
                  const s = openai.find((x) => x.id === oaLang)!;
                  return <CodeBlock title={s.label} code={reveal || !key ? s.code : mask(s.code, key)} copyText={s.code} hidden={key ? !reveal : undefined} onToggle={key ? () => setReveal((v) => !v) : undefined} />;
                })()}
              </div>
              <p className="text-[12.5px] leading-5 text-ink-2">Supports chat and streaming. Tool-calling and image inputs aren&apos;t supported yet; the answer text, token counts and the cost are returned (under <code className="font-mono">metabolic</code> in non-streaming replies).</p>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* 4 · Test */}
      <Card className="p-5 sm:p-6">
        <StepHead n={4} title="Check that it works" done={test.kind === "ok"} />
        <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-ink-2">This talks to Metabolic AI the same way your agent will, so a green tick here means the key and address are right.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="ink" onClick={() => void runTest(false)} disabled={!key || test.kind === "busy"} loading={test.kind === "busy"}>Test the connection</Button>
          <Button variant="secondary" onClick={() => void runTest(true)} disabled={!key || test.kind === "busy" || credits <= 0n}>Ask a test question</Button>
          {!key && <span className="text-[12.5px] text-muted">Create or paste a key first.</span>}
          {key && credits <= 0n && <span className="text-[12.5px] text-muted">A test question costs a fraction of a cent of credit.</span>}
        </div>
        <AnimatePresence>
          {test.kind === "ok" && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status" className="mt-3 flex items-start gap-2 rounded-xl bg-g-50 p-3 text-[13px] text-g-900">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-g-700 text-[11px] font-bold text-white">✓</span>
              {test.text}
            </motion.div>
          )}
          {test.kind === "error" && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="mt-3 rounded-xl bg-sv-tint p-3 text-[13px] text-sv-text">
              {test.text}
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      <p className="text-[12.5px] leading-5 text-muted">
        Setup formats follow each tool&apos;s own documentation and tools change their config often. The endpoints themselves are tested here; if a tool&apos;s format has moved, its docs will show where the URL and header go. Keys can be revoked any time in{" "}
        <Link href="/console/developers" className="font-semibold underline">Developers</Link>. Every request an agent makes appears in <Link href="/console/decisions" className="font-semibold underline">Decisions</Link>.{" "}
        <ButtonLink href="/console/developers" size="sm" variant="ghost" className="ml-1 h-6 px-2 text-[12px]">Manage keys →</ButtonLink>
      </p>
    </div>
  );
}

function StepHead({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-bold", done ? "bg-g-700 text-white" : "bg-ink text-white")}>{done ? "✓" : n}</span>
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
    </div>
  );
}
