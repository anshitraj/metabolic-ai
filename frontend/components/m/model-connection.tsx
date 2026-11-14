"use client";

import { useState } from "react";
import { useSession } from "@/lib/client/session";
import { api } from "@/lib/client/api";
import { Badge, Button } from "./ui";

export function ModelConnectionTest({ modelId }: { modelId: string }) {
  const { me } = useSession();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; latencyMs?: number } | null>(null);
  const check = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await api("/api/models/check", { method: "POST", json: { modelId } }));
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Could not run the connection test." });
    } finally {
      setBusy(false);
    }
  };
  return <div className="mt-4 border-t border-line pt-3">
    {me?.user?.role === "operator" ? <>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void check()}>{busy ? "Waiting for a test answer…" : "Test this model"}</Button>
      <p className="mt-1.5 text-[11.5px] leading-4 text-muted">Sends one short prompt. Uses provider quota and may incur a small provider charge.</p>
    </> : <p className="text-[12px] text-muted">An operator can sign in to send a test prompt and check this model.</p>}
    <div role="status" aria-live="polite">{result && <div className="mt-2 text-[12.5px] leading-5"><Badge tone={result.ok ? "green" : "red"}>{result.ok ? "Answer received" : "Needs attention"}</Badge><p className="mt-1 text-ink-2">{result.message}</p>{result.ok && result.latencyMs !== undefined && <p className="mt-1 font-mono text-[11px] text-muted">{(result.latencyMs / 1000).toFixed(1)}s</p>}</div>}</div>
  </div>;
}
