"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/use-api";
import { Button, Card, Hash, ErrorNote, inputClass, cx } from "@/components/m/ui";
import type { ReceiptDTO } from "@/components/m/receipt";

type Verification = {
  receiptId: string;
  found: boolean;
  payload: Record<string, unknown> | null;
  storedHash: string | null;
  recomputedHash: string | null;
  onChainHash: string | null;
  match: boolean;
  chainError: string | null;
  contractId: string | null;
  explorer: string | null;
  network: string;
};

function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function VerifyPage() {
  return (
    <div className="m-app">
      <Nav />
      <main className="mx-auto max-w-[900px] px-4 py-14 sm:px-6">
        <div className="m-label text-g-700">Verify</div>
        <h1 className="mt-3 font-serif text-[42px] leading-[48px]">Check a receipt yourself.</h1>
        <p className="mt-3 max-w-2xl text-[15.5px] leading-7 text-ink-2">Your browser recomputes the SHA-256 of the receipt&apos;s canonical payload and compares it with the commitment stored by the NEAR contract&apos;s <code className="font-mono">get_receipt</code> method. This commits a specific accounting record; it does not prove that an AI provider was paid.</p>
        <Suspense fallback={<p role="status" className="mt-8 text-[13px] text-muted">Loading receipt verification…</p>}>
          <Verify />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}

function Verify() {
  const params = useSearchParams();
  const [id, setId] = useState(params.get("id") ?? "");
  const [v, setV] = useState<Verification | null>(null);
  const [browserHash, setBrowserHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useApi<{ receipts: ReceiptDTO[] }>("/api/receipts");

  const run = useCallback(async (rid: string) => {
    setBusy(true);
    setError(null);
    setV(null);
    setBrowserHash(null);
    try {
      const r = await api<Verification>(`/api/receipts/${encodeURIComponent(rid)}`);
      setV(r);
      if (r.payload) setBrowserHash(await sha256Hex(canonicalJson(r.payload)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const q = params.get("id");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- verify the id from the URL
    if (q) void run(q);
  }, [params, run]);

  const browserMatch = !!browserHash && !!v?.match && !!v?.onChainHash && browserHash === v.onChainHash;
  return (
    <>
      <form
        className="mt-8 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(id.trim());
        }}
      >
        <input className={cx(inputClass, "max-w-md flex-1 font-mono")} placeholder="rcpt_20261114_153000" value={id} onChange={(e) => setId(e.target.value)} aria-label="Receipt id" />
        <Button type="submit" variant="ink" loading={busy} disabled={!id.trim()}>Verify</Button>
      </form>
      {list.data && list.data.receipts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
          <span className="text-muted">Recent:</span>
          {list.data.receipts.filter((r) => r.status === "finalized").slice(0, 5).map((r) => (
            <button key={r.id} type="button" className="font-mono text-g-700 hover:underline" onClick={() => { setId(r.id); void run(r.id); }}>{r.id}</button>
          ))}
        </div>
      )}
      {error && <div className="mt-6"><ErrorNote message={error} /></div>}
      {v && (
        <Card className="mt-8 overflow-hidden">
          <div className={cx("flex items-center gap-3 px-5 py-4 text-[16px] font-semibold", browserMatch ? "bg-g-50 text-g-900" : "bg-sv-tint text-sv-text")}>
            <span className="text-[22px]">{browserMatch ? "✓" : "✕"}</span>
            {browserMatch ? "Match — the committed hash equals the hash of this payload." : !v.found ? "No receipt with that id." : v.chainError ? `Couldn't read the chain: ${v.chainError}` : !v.onChainHash ? "Not found in the contract." : "Mismatch — the payload does not hash to the committed value."}
          </div>
          <dl className="grid gap-x-6 gap-y-3 p-5 text-[13px] sm:grid-cols-[180px_1fr]">
            <dt className="text-muted">Hash computed in your browser</dt>
            <dd className="break-all font-mono text-[12px]">{browserHash ?? "—"}</dd>
            <dt className="text-muted">Hash stored on NEAR</dt>
            <dd className="break-all font-mono text-[12px]">{v.onChainHash ?? "—"}</dd>
            <dt className="text-muted">Contract</dt>
            <dd className="font-mono text-[12px]">{v.contractId ?? "—"} · {v.network}</dd>
            {v.explorer && (
              <>
                <dt className="text-muted">Commit transaction</dt>
                <dd><Hash value={v.explorer.split("/").pop() ?? ""} href={v.explorer} /></dd>
              </>
            )}
          </dl>
          {v.payload && (
            <div className="border-t border-line p-5">
              <div className="mb-2 text-[12px] font-semibold text-muted">Canonical payload</div>
              <pre className="overflow-x-auto rounded-lg bg-stage p-4 font-mono text-[12px] leading-5 text-stage-ink">{JSON.stringify(v.payload, null, 2)}</pre>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
