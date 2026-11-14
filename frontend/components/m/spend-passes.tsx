"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/use-api";
import { big, formatUsd, parseUsd } from "@/lib/economics/money";
import { Badge, Button, Card, Dialog, Empty, ErrorNote, Field, Skeleton, cx, inputClass } from "./ui";

type Pass = { id: string; name: string; agentName: string; totalBudget: string; maxPerRequest: string; spent: string; reserved: string; remaining: string; allowedTiers: string[]; allowedProviders: string[]; allowedModels: string[]; policyVersion: number; expiresAt: string; status: string };
type Model = { id: string; label: string; tier: string; provider: string; enabled: boolean };
type Activity = { id: string; status: string; model: string | null; charge: string; providerCost: string; costSource: string; reserved: string; partial: boolean; error: string | null; recoveryRequired: boolean; at: string; explanation: string | null; receipts: { id: string; status: string }[] };
const money = (n: string) => formatUsd(big(n), { precise: true });

export function SpendPasses() {
  const passes = useApi<{ passes: Pass[] }>("/api/spend-passes", { intervalMs: 10_000 });
  const models = useApi<{ models: Model[] }>("/api/models");
  const keys = useApi<{ keys: { id: string; name: string; spendPassId: string | null; revokedAt: string | null }[] }>("/api/keys");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("passId");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore an explicit activity deep link
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setSelected(id);
  }, []);
  const select = (id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("passId", id); else url.searchParams.delete("passId");
    history.replaceState(null, "", url.pathname + url.search);
  };
  const created = async (result: { pass: Pass; secret: string | null }) => {
    setCreating(false); setSecret(result.secret); setCopied(false); select(result.pass.id);
    await Promise.all([passes.reload(), keys.reload()]);
  };
  return <div className="space-y-4">
    <Card className="grid gap-4 p-5 md:grid-cols-3">
      {[["App API key", "Identifies the agent. Give the agent its bound key, never a wallet private key."], ["Spend Pass", "Limits how much that agent may charge to your existing workspace credits."], ["Provider API key", "Stays on the server. Gemini calls use the operator-funded provider account."]].map(([title, desc]) => <div key={title}><h2 className="text-[14px] font-semibold">{title}</h2><p className="mt-1 text-[12.5px] leading-5 text-ink-2">{desc}</p></div>)}
    </Card>
    {secret && <Card className="border-g-500 p-4"><h2 className="text-[14px] font-semibold">Your agent key — shown once</h2><p className="mt-1 text-[12.5px] text-ink-2">This key is permanently bound to its Spend Pass. Store it securely before closing this message.</p><code className="mt-3 block break-all rounded-lg bg-paper-sunken p-3 text-[12px]">{secret}</code><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { setCopied(false); } }}>{copied ? "Copied" : "Copy agent key"}</Button><Button size="sm" variant="ghost" onClick={() => setSecret(null)}>I saved it</Button></div></Card>}
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-serif text-[25px]">Agent spending permissions</h2><p className="mt-1 text-[13px] text-ink-2">Passes allocate permission to spend existing credit. Creating one does not add funds.</p></div><Button variant="green" onClick={() => setCreating(true)}>Create Spend Pass</Button></div>
    {passes.error && <ErrorNote message={passes.error} onRetry={() => void passes.reload()} />}
    {passes.loading ? <Skeleton className="h-36" /> : selected ? <PassDetail key={selected} id={selected} onBack={() => select(null)} onChanged={() => void passes.reload()} /> : <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{passes.data?.passes.map((p) => <button key={p.id} type="button" onClick={() => select(p.id)} className="rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-g-700 focus-visible:outline-2 focus-visible:outline-g-700"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{p.name}</span><PassBadge status={p.status} /></div><p className="mt-1 text-[13px] text-muted">{p.agentName}</p><p className="mt-4 font-mono text-[20px]">{money(p.remaining)} <span className="font-sans text-[12px] text-muted">unreserved budget</span></p><p className="mt-2 text-[12px] leading-5 text-ink-2">Up to {money(p.maxPerRequest)} per request · {p.allowedTiers.join(", ")}<br />Expires {new Date(p.expiresAt).toLocaleString()}</p><span className="mt-3 block text-[12px] font-semibold text-g-700">Details and activity →</span></button>)}</div>
      {!passes.data?.passes.length && !passes.error && <Empty title="Give an agent a bounded allowance">Create a named pass, choose its limits, then use its app API key for inference. The server enforces these rules before calling an AI provider.</Empty>}
    </>}
    <Dialog open={creating} onClose={() => setCreating(false)} title="Create Spend Pass" wide><CreatePass models={models.data?.models ?? []} keys={(keys.data?.keys ?? []).filter((k) => !k.revokedAt && !k.spendPassId)} onCreated={created} /></Dialog>
  </div>;
}

function PassBadge({ status }: { status: string }) { return <Badge tone={status === "active" ? "green" : status === "revoked" ? "red" : "amber"}>{status}</Badge>; }

function PassDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const data = useApi<{ pass: Pass; activity: Activity[]; rejected: { id: string; at: string; code: string; message: string; policyVersion: number }[] }>(`/api/spend-passes/${id}`, { intervalMs: 5000 });
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoke = async () => {
    setRevoking(true); setError(null);
    try { await api(`/api/spend-passes/${id}`, { method: "DELETE" }); await data.reload(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not revoke this pass."); }
    finally { setRevoking(false); }
  };
  const p = data.data?.pass;
  return <div className="space-y-4">
    <Button variant="ghost" size="sm" onClick={onBack}>← All Spend Passes</Button>
    {(error || data.error) && <ErrorNote message={error ?? data.error!} onRetry={() => void data.reload()} />}
    {p ? <>
      <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-[18px] font-semibold">{p.name}</h2><PassBadge status={p.status} /></div><p className="mt-1 text-[13px] text-muted">Agent: {p.agentName} · policy v{p.policyVersion}</p></div>{p.status !== "revoked" && <Button size="sm" variant="danger" loading={revoking} onClick={() => void revoke()}>Revoke Spend Pass</Button>}</div>
      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">{[["Total budget", p.totalBudget], ["Spent", p.spent], ["In flight", p.reserved], ["Remaining", p.remaining]].map(([label, value]) => <div key={label}><dt className="text-[12px] text-muted">{label}</dt><dd className="mt-1 break-all font-mono text-[16px]">{money(value)}</dd></div>)}</dl>
      <div className="mt-5 rounded-lg bg-paper-sunken p-4"><h3 className="text-[13px] font-semibold">Effective permission</h3><p className="mt-2 text-[13px] leading-6 text-ink-2">This agent can charge at most <b>{money(p.maxPerRequest)} per request</b>, within the unreserved total budget and your workspace&apos;s available credits. Allowed tiers: <b>{p.allowedTiers.join(", ")}</b>. Providers: <b>{p.allowedProviders.join(", ") || "any configured provider"}</b>. Models: <b className="break-words">{p.allowedModels.join(", ") || "any matching model"}</b>. Expires <b>{new Date(p.expiresAt).toLocaleString()}</b>. Business policy and provider health may restrict this further.</p></div>
      <p className="mt-3 text-[12px] leading-5 text-muted">Limits are fixed for this pass. Create a new pass to change them. Revocation and expiration block new requests; work already admitted settles within its existing reservation.</p></Card>
      <Card className="p-5"><h3 className="text-[15px] font-semibold">Agent request activity</h3><p className="mt-1 text-[12px] text-muted">Customer charges and offchain provider expenses are recorded separately.</p>
      <div className="mt-3 divide-y divide-line">{data.data?.activity.map((u) => <details key={u.id} id={`request-${u.id}`} className="py-3"><summary className="cursor-pointer text-[13px]"><span className="font-semibold">{u.model?.split(":").pop() ?? "Request"}</span><span className="ml-2 text-muted">{u.status} · {money(u.charge)} charged</span></summary><div className="mt-3 space-y-2 text-[12.5px] leading-5 text-ink-2"><a className="break-all font-mono text-g-700 underline" href={`#request-${u.id}`}>Request {u.id}</a><p>{new Date(u.at).toLocaleString()} · authorized maximum {money(u.reserved)}</p><p>Provider expense: {u.costSource.startsWith("unknown") ? "unknown — operator reconciliation needed" : money(u.providerCost)} · source: {u.costSource.replaceAll("_", " ")}</p>{u.explanation && <p>{u.explanation}</p>}{u.error && <p className="text-sv-text">{u.error}</p>}{u.recoveryRequired && <Badge tone="amber">Operator reconciliation required</Badge>}{u.receipts.length ? u.receipts.map((r) => <a key={r.id} href={`/verify?id=${r.id}`} className="block break-all font-mono text-g-700 underline">Accounting commitment {r.id} · {r.status} →</a>) : <p className="text-muted">No accounting commitment covers this finalized request yet.</p>}</div></details>)}</div>
      {!data.data?.activity.length && <p className="py-4 text-[13px] text-muted">No requests yet. Use the agent&apos;s bound API key to call /api/v1/inference.</p>}</Card>
      {!!data.data?.rejected?.length && <Card className="p-5"><h3 className="text-[15px] font-semibold">Blocked attempts</h3><p className="mt-1 text-[12px] text-muted">Rejected before provider execution. No customer charge.</p><ul className="mt-3 divide-y divide-line">{data.data.rejected.map((r) => <li key={r.id} className="py-3 text-[12.5px] leading-5"><Badge tone="red">{r.code.replaceAll("_", " ")}</Badge><p className="mt-1 text-ink-2">{r.message}</p><p className="mt-1 text-muted">{new Date(r.at).toLocaleString()} · pass policy v{r.policyVersion}</p></li>)}</ul></Card>}
    </> : <Skeleton className="h-48" />}
  </div>;
}

function CreatePass({ models, keys, onCreated }: { models: Model[]; keys: { id: string; name: string }[]; onCreated: (r: { pass: Pass; secret: string | null }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [agent, setAgent] = useState("");
  const [budget, setBudget] = useState("1.00");
  const [cap, setCap] = useState("0.05");
  const [expires, setExpires] = useState(() => { const d = new Date(Date.now() + 7 * 86400_000); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); });
  const [tiers, setTiers] = useState(["premium", "standard", "economy"]);
  const [provider, setProvider] = useState("");
  const [allowedModels, setAllowedModels] = useState<string[]>([]);
  const [keyId, setKeyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null);
    const total = parseUsd(budget), max = parseUsd(cap), expiry = new Date(expires);
    if (total === null || max === null || total <= 0n || max <= 0n || max > total || !Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now() || !tiers.length) return setError("Enter positive dollar limits, a future expiry and at least one tier. The request cap must fit the total budget.");
    setBusy(true);
    try { await onCreated(await api("/api/spend-passes", { method: "POST", json: { name, agentName: agent, totalBudget: total.toString(), maxPerRequest: max.toString(), allowedTiers: tiers, allowedProviders: provider ? [provider] : [], allowedModels, expiresAt: expiry.toISOString(), apiKeyId: keyId || undefined } })); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create this pass."); }
    finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="space-y-4">
    <p className="text-[13px] leading-5 text-ink-2">Choose the most this agent may spend from your existing credits. Limits apply to customer charges, including the maximum allowed output.</p>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Pass name"><input required maxLength={60} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Research allowance" /></Field><Field label="Agent name"><input required maxLength={80} className={inputClass} value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="Research assistant" /></Field><Field label="Total budget (USD)"><input required inputMode="decimal" className={inputClass} value={budget} onChange={(e) => setBudget(e.target.value)} /></Field><Field label="Maximum charge per request (USD)"><input required inputMode="decimal" className={inputClass} value={cap} onChange={(e) => setCap(e.target.value)} /></Field><Field label="Expires at (your local time)"><input required type="datetime-local" className={inputClass} value={expires} onChange={(e) => setExpires(e.target.value)} /></Field><Field label="Agent API key"><select className={inputClass} value={keyId} onChange={(e) => setKeyId(e.target.value)}><option value="">Create a new bound key</option>{keys.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field></div>
    <fieldset><legend className="mb-2 text-[13px] font-semibold">Allowed tiers</legend><div className="flex flex-wrap gap-2">{["premium", "standard", "economy"].map((tier) => <label key={tier} className={cx("flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px]", tiers.includes(tier) ? "border-g-700 bg-g-50" : "border-line")}><input type="checkbox" checked={tiers.includes(tier)} onChange={(e) => setTiers((t) => e.target.checked ? [...t, tier] : t.filter((v) => v !== tier))} className="accent-g-700" />{tier}</label>)}</div></fieldset>
    <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-[13px] font-semibold">Optional provider and model restrictions</summary><div className="mt-3 space-y-3"><Field label="Allowed provider"><select className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value)}><option value="">Any configured provider</option>{[...new Set(models.map((m) => m.provider))].map((p) => <option key={p}>{p}</option>)}</select></Field><fieldset><legend className="mb-1 text-[12px] text-muted">Choose specific models, or leave all unchecked to allow any matching model.</legend><div className="max-h-48 space-y-1 overflow-y-auto">{models.map((m) => <label key={m.id} className="flex min-h-9 items-center gap-2 text-[12.5px]"><input type="checkbox" className="accent-g-700" checked={allowedModels.includes(m.id)} onChange={(e) => setAllowedModels((list) => e.target.checked ? [...list, m.id] : list.filter((v) => v !== m.id))} />{m.label} · {m.tier}{!m.enabled && " · key not configured"}</label>)}</div></fieldset></div></details>
    {error && <ErrorNote title="Check the pass settings" message={error} />}<Button type="submit" variant="green" loading={busy}>Create pass{keyId ? " and bind key" : " and agent key"}</Button>
  </form>;
}
