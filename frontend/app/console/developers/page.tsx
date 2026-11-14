"use client";

import { useState } from "react";
import { useSession } from "@/lib/client/session";
import { useApi } from "@/lib/client/use-api";
import { api } from "@/lib/client/api";
import { big, formatUsd } from "@/lib/economics/money";
import { ConnectWallet } from "@/components/m/wallet";
import { SpendPasses } from "@/components/m/spend-passes";
import { Badge, Button, Card, Empty, ErrorNote, Field, Hash, PageHeader, Skeleton, TierBadge, TimeAgo, cx, inputClass } from "@/components/m/ui";

type Key = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
type UsageRow = { id: string; channel: string; status: string; model: string | null; tier: string | null; inTokens: number; outTokens: number; charge: string; costIsEstimated: boolean; latencyMs: number | null; error: string | null; createdAt: string };

const TABS = ["Spend Passes", "Keys", "Usage", "Quickstart", "Errors"] as const;

export default function DevelopersPage() {
  const { me, loading } = useSession();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Spend Passes");
  if (loading) return <Skeleton className="h-60" />;
  return (
    <div>
      <PageHeader title="Developer API" description="Use Metabolic AI as a paid, cost-aware inference API. Same router, same policy, same prepaid credits as the workspace." />
      <p className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-[13px] leading-5 text-ink-2">Keys here let your app call Metabolic AI. To check the Google Gemini connection or its available models, visit <a href="/console/models" className="font-semibold text-g-700 underline underline-offset-2">AI models</a>.</p>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} aria-current={tab === t} className={cx("-mb-px shrink-0 border-b-2 px-3 py-2 text-[14px]", tab === t ? "border-g-700 font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink")}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Quickstart" ? (
        <Quickstart />
      ) : tab === "Errors" ? (
        <Errors />
      ) : !me?.user ? (
        <Empty title="Sign in to manage API keys" action={<ConnectWallet />}>Keys draw on the same prepaid credits as your workspace.</Empty>
      ) : tab === "Spend Passes" ? (
        <SpendPasses />
      ) : tab === "Keys" ? (
        <Keys />
      ) : (
        <Usage />
      )}
    </div>
  );
}

function Keys() {
  const k = useApi<{ keys: Key[] }>("/api/keys");
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ secret: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setError(null);
    try {
      const r = await api<{ secret: string; name: string }>("/api/keys", { method: "POST", json: { name: name || "Default" } });
      setCreated(r);
      setName("");
      void k.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create key.");
    }
  };
  const revoke = async (id: string) => {
    if (!confirm("Revoke this key? Requests using it will fail immediately.")) return;
    await api(`/api/keys/${id}`, { method: "DELETE" });
    void k.reload();
  };
  return (
    <div className="space-y-4">
      {created && (
        <div className="rounded-xl bg-stage p-4 text-stage-ink">
          <div className="text-[13px] font-semibold">Key “{created.name}” created. Copy it now — it will not be shown again.</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-white/5 p-2 font-mono text-[13px]">
            <span className="break-all">{created.secret}</span>
            <Button size="sm" variant="stage" onClick={() => void navigator.clipboard.writeText(created.secret)}>Copy</Button>
          </div>
          <Button size="sm" variant="stage" className="mt-3" onClick={() => setCreated(null)}>I&apos;ve saved it</Button>
        </div>
      )}
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[220px] flex-1">
          <Field label="New key name">
            <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. backend-prod" />
          </Field>
        </div>
        <Button variant="green" onClick={create}>Create key</Button>
      </Card>
      {error && <ErrorNote message={error} />}
      <Card className="overflow-hidden">
        {k.loading ? (
          <Skeleton className="m-4 h-24" />
        ) : k.data?.keys.length ? (
          <table className="w-full text-left text-[13px]">
            <thead className="bg-paper-sunken text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-2">Name</th><th className="px-3 py-2">Key</th><th className="px-3 py-2">Created</th><th className="px-3 py-2">Last used</th><th className="px-4 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {k.data.keys.map((x) => (
                <tr key={x.id} className={x.revokedAt ? "opacity-50" : ""}>
                  <td className="px-4 py-2.5 font-medium">{x.name}</td>
                  <td className="px-3 py-2.5 font-mono text-[12px]">{x.prefix}…</td>
                  <td className="px-3 py-2.5 text-muted"><TimeAgo iso={x.createdAt} /></td>
                  <td className="px-3 py-2.5 text-muted">{x.lastUsedAt ? <TimeAgo iso={x.lastUsedAt} /> : "never"}</td>
                  <td className="px-4 py-2.5 text-right">{x.revokedAt ? <Badge>revoked</Badge> : <Button size="sm" variant="ghost" className="text-sv-text" onClick={() => void revoke(x.id)}>Revoke</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-[13px] text-muted">No keys yet.</p>
        )}
      </Card>
      <p className="text-[12.5px] text-muted">Rate limit: 60 requests/minute per key. Keys are stored as SHA-256 hashes; we can&apos;t recover a lost key.</p>
    </div>
  );
}

function Usage() {
  const u = useApi<{ requests: UsageRow[]; daily: { day: string; charge: string; n: number }[] }>("/api/usage");
  if (u.loading) return <Skeleton className="h-60" />;
  const rows = u.data?.requests ?? [];
  const total = (u.data?.daily ?? []).reduce((n, d) => n + big(d.charge), 0n);
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap gap-8 p-4 text-[13px]">
        <div><div className="text-muted">Requests (14 days)</div><div className="m-num text-[20px]">{(u.data?.daily ?? []).reduce((n, d) => n + d.n, 0)}</div></div>
        <div><div className="text-muted">Charged (14 days)</div><div className="m-num text-[20px]">{formatUsd(total)}</div></div>
      </Card>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="p-4 text-[13px] text-muted">No requests yet.</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="bg-paper-sunken text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-2">When</th><th className="px-3 py-2">Channel</th><th className="px-3 py-2">Model</th><th className="px-3 py-2">Tokens</th><th className="px-3 py-2">Charge</th><th className="px-3 py-2">Status</th><th className="px-4 py-2">Id</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-muted"><TimeAgo iso={r.createdAt} /></td>
                  <td className="px-3 py-2">{r.channel}</td>
                  <td className="px-3 py-2"><span className="font-mono text-[12px]">{r.model?.split(":").pop() ?? "—"}</span> <TierBadge tier={r.tier} /></td>
                  <td className="px-3 py-2 m-num">{r.inTokens}/{r.outTokens}</td>
                  <td className="px-3 py-2 m-num">{formatUsd(big(r.charge))}</td>
                  <td className="px-3 py-2"><Badge tone={r.status === "finalized" ? "green" : r.status === "refunded" ? "amber" : "neutral"}>{r.status}</Badge></td>
                  <td className="px-4 py-2"><Hash value={r.id} chars={4} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Quickstart() {
  const [lang, setLang] = useState<"cURL" | "JavaScript" | "Python">("cURL");
  const host = typeof window !== "undefined" ? window.location.origin : "https://your-host";
  const code = {
    cURL: `curl ${host}/api/v1/inference \\
  -H "Authorization: Bearer $METABOLIC_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "messages": [{ "role": "user", "content": "Summarise NEAR in one line" }],
    "max_output_tokens": 400
  }'`,
    JavaScript: `const res = await fetch("${host}/api/v1/inference", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.METABOLIC_KEY}\`,
    "Idempotency-Key": crypto.randomUUID(),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    messages: [{ role: "user", content: "Summarise NEAR in one line" }],
    requires: ["chat"],        // optional capability floor
    stream: false,             // true → Server-Sent Events
  }),
});
const { output, routing, billing } = await res.json();`,
    Python: `import os, uuid, requests

r = requests.post(
    "${host}/api/v1/inference",
    headers={
        "Authorization": f"Bearer {os.environ['METABOLIC_KEY']}",
        "Idempotency-Key": str(uuid.uuid4()),
    },
    json={"messages": [{"role": "user", "content": "Summarise NEAR in one line"}]},
)
data = r.json()
print(data["output"], data["routing"]["explanation"])`,
  }[lang];
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="overflow-hidden">
        <div className="flex gap-1 border-b border-line px-3 pt-2">
          {(["cURL", "JavaScript", "Python"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={cx("-mb-px border-b-2 px-3 py-1.5 text-[13px]", lang === l ? "border-g-700 font-semibold" : "border-transparent text-ink-2")}>{l}</button>
          ))}
        </div>
        <pre className="overflow-x-auto bg-stage p-4 font-mono text-[12.5px] leading-5 text-stage-ink">{code}</pre>
      </Card>
      <Card className="p-5 text-[13.5px]">
        <h3 className="font-semibold">Response</h3>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-paper-sunken p-3 font-mono text-[12px] leading-5">{`{
  "id": "…usage id…",
  "output": "NEAR is a sharded, developer-friendly L1…",
  "routing": {
    "model": "anthropic:claude-sonnet-5-5",
    "tier": "standard",
    "state": "DEFENSIVE",
    "explanation": "Routed to Standard (claude-sonnet-5-5): Premium excluded — margin 12% below 30% floor in DEFENSIVE."
  },
  "billing": {
    "input_tokens": 41, "output_tokens": 118,
    "provider_cost_micro_usd": "1262",
    "charge_micro_usd": "2524",
    "margin_bp": 5000,
    "cost_is_estimated": false
  }
}`}</pre>
        <h3 className="mt-4 font-semibold">How routing works</h3>
        <p className="mt-1 text-ink-2">Every capable, healthy model is priced for your request. The policy engine removes any that would run below the current state&apos;s margin floor or above its cost cap, then picks the best value. Pin a tier with <code className="font-mono">&quot;tier&quot;</code> — it still has to pass policy. Money values are integer micro-USD strings.</p>
      </Card>
    </div>
  );
}

function Errors() {
  const rows: [string, string, string][] = [
    ["401", "INVALID_API_KEY", "Missing, malformed or revoked key."],
    ["402", "INSUFFICIENT_CREDITS", "Prepaid credit can't cover the request. `needed_micro_usd` says how much more."],
    ["409", "DUPLICATE_REQUEST", "Idempotency-Key already used; the first request's charge stands."],
    ["422", "NO_CAPABLE_MODEL", "No configured model has the capabilities you required."],
    ["422", "COST_CAP", "No model fits the state's margin and cost limits."],
    ["429", "RATE_LIMITED / BUSY", "Slow down; `retry_after_s` when known."],
    ["502", "PROVIDER_UNAVAILABLE", "Providers failed before producing output. You were not charged."],
    ["503", "FUNDING_REQUIRED", "The business is in Survival and protecting its reserve."],
    ["503", "POLICY_PAUSED", "The operator paused inference."],
    ["503", "DAILY_CAP", "The daily provider spending cap was reached."],
  ];
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-paper-sunken text-[11px] uppercase tracking-wide text-muted">
          <tr><th className="px-4 py-2">HTTP</th><th className="px-3 py-2">Code</th><th className="px-4 py-2">Meaning</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(([h, c, m]) => (
            <tr key={c}><td className="px-4 py-2 m-num">{h}</td><td className="px-3 py-2 font-mono text-[12px]">{c}</td><td className="px-4 py-2 text-ink-2">{m}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-[12.5px] text-muted">Errors are <code className="font-mono">{`{ "error": { "code", "message", "request_id" } }`}</code>. Every response carries <code className="font-mono">x-request-id</code>.</p>
    </Card>
  );
}
