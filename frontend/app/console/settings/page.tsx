"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/client/session";
import { useLive } from "@/lib/client/live";
import { useApi } from "@/lib/client/use-api";
import { api } from "@/lib/client/api";
import { formatUsd, parseUsd, big } from "@/lib/economics/money";
import { ConnectWallet } from "@/components/m/wallet";
import { Badge, Button, ButtonLink, Card, ErrorNote, Field, PageHeader, cx, inputClass } from "@/components/m/ui";

type Policy = {
  version: number;
  hardReserveMicro: string;
  abundanceMinMarginBp: number;
  abundanceMinCoverageBp: number;
  defensiveEnterMarginBp: number;
  defensiveEnterCoverageBp: number;
  minDwellSeconds: number;
  recoveryDwellSeconds: number;
  hysteresisBp: number;
};

export default function SettingsPage() {
  const { me, config, signOut } = useSession();
  const reduced = useLive((s) => s.reducedEffects);
  const setReduced = useLive((s) => s.setReducedEffects);
  const operator = me?.user?.role === "operator";
  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      <Card className="mb-4 p-5">
        <h2 className="text-[15px] font-semibold">Account</h2>
        {me?.user ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[13.5px]">
            <div>
              <div className="font-mono">{me.user.accountId}</div>
              <div className="text-muted">NEAR {config?.network} · {me.user.role}</div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void signOut()}>Sign out</Button>
          </div>
        ) : (
          <div className="mt-3"><ConnectWallet /></div>
        )}
      </Card>
      <Card className="mb-4 p-5">
        <h2 className="text-[15px] font-semibold">AI provider connections</h2>
        <p className="mt-1 text-[13px] leading-5 text-ink-2">One provider key can enable several AI models. Provider keys are managed on the server; the Developer API page creates keys for calling Metabolic AI from your own app.</p>
        <div className="mt-3 flex flex-wrap gap-2">{config?.providers.map((p) => <Badge key={p.provider} tone={p.configured ? "green" : "neutral"}>{p.provider} · {p.configured ? "key configured" : "no key set"}</Badge>)}</div>
        <ButtonLink href="/console/models" variant="secondary" size="sm" className="mt-4">View models and connection tests →</ButtonLink>
      </Card>
      <Card className="mb-4 p-5">
        <h2 className="text-[15px] font-semibold">Visual effects</h2>
        <label className="mt-3 flex items-center justify-between gap-4 text-[13.5px]">
          <span>
            Reduced effects
            <span className="block text-[12.5px] text-muted">Turns off bloom, lowers particle counts and resolution. Defaults on when your system asks for reduced motion.</span>
          </span>
          <input type="checkbox" className="h-5 w-5 accent-[#0a6b44]" checked={reduced} onChange={(e) => setReduced(e.target.checked)} />
        </label>
      </Card>
      {operator ? <OperatorControls /> : (
        <Card className="p-5 text-[13.5px] text-ink-2">
          Policy thresholds and the emergency pause are operator controls. Operators are the NEAR accounts listed in <code className="font-mono">OPERATOR_ACCOUNT_IDS</code>.
        </Card>
      )}
    </div>
  );
}

function OperatorControls() {
  const overview = useLive((s) => s.overview);
  const p = useApi<Policy>("/api/admin/policy");
  const [form, setForm] = useState<Policy | null>(null);
  const [reserve, setReserve] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (p.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the form from the server
      setForm(p.data);
      setReserve((Number(big(p.data.hardReserveMicro)) / 1e6).toFixed(2));
    }
  }, [p.data]);
  const save = async () => {
    if (!form) return;
    setErr(null);
    const micro = parseUsd(reserve);
    if (micro === null) return setErr("Hard reserve must be a dollar amount.");
    try {
      const r = await api<Policy>("/api/admin/policy", { method: "PUT", json: { ...form, hardReserveMicro: micro.toString(), version: undefined } });
      setMsg(`Saved as policy v${r.version}.`);
      void p.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    }
  };
  const pause = async (paused: boolean) => {
    if (paused && !confirm("Pause all inference now?")) return;
    await api("/api/admin/pause", { method: "POST", json: { paused } });
    setMsg(paused ? "Inference paused." : "Inference resumed.");
  };
  const num = (k: keyof Policy, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input className={inputClass} type="number" value={form ? (form[k] as number) : ""} onChange={(e) => form && setForm({ ...form, [k]: Number(e.target.value) })} />
    </Field>
  );
  return (
    <>
      <Card className="mb-4 p-5">
        <h2 className="text-[15px] font-semibold">Emergency pause</h2>
        <p className="mt-1 text-[13px] text-ink-2">Blocks every inference request until resumed. Deposits and receipts keep working.</p>
        <div className="mt-3 flex gap-2">
          <Button variant="danger" size="sm" onClick={() => void pause(true)} disabled={overview?.paused}>Pause inference</Button>
          <Button variant="secondary" size="sm" onClick={() => void pause(false)} disabled={!overview?.paused}>Resume</Button>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">Economic policy {p.data && <span className="font-normal text-muted">· v{p.data.version}</span>}</h2>
        <p className="mt-1 text-[13px] text-ink-2">Saving creates a new policy version; old versions stay attached to the decisions they made. Ratios are basis points (3000 = 30%; coverage 30000 = 3× reserve).</p>
        {form && (
          <div className={cx("mt-4 grid gap-4 sm:grid-cols-2")}>
            <Field label="Hard reserve (USD)" hint={`Currently ${formatUsd(big(form.hardReserveMicro))}`}>
              <input className={inputClass} value={reserve} onChange={(e) => setReserve(e.target.value)} />
            </Field>
            {num("hysteresisBp", "Hysteresis (bp)")}
            {num("abundanceMinMarginBp", "Abundance: min margin (bp)")}
            {num("abundanceMinCoverageBp", "Abundance: min coverage (bp)")}
            {num("defensiveEnterMarginBp", "Defensive below margin (bp)")}
            {num("defensiveEnterCoverageBp", "Defensive below coverage (bp)")}
            {num("minDwellSeconds", "Minimum dwell (s)")}
            {num("recoveryDwellSeconds", "Recovery dwell (s)")}
          </div>
        )}
        {err && <div className="mt-3"><ErrorNote message={err} /></div>}
        {msg && <p className="mt-3 text-[13px] text-g-700">{msg}</p>}
        <Button className="mt-4" variant="ink" onClick={save} disabled={!form}>Save new policy version</Button>
      </Card>
    </>
  );
}
