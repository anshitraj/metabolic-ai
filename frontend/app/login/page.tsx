"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SessionProvider, useSession } from "@/lib/client/session";
import { ConnectWallet } from "@/components/m/wallet";
import { Logo } from "@/components/logo";
import { OrganismFallback } from "@/components/organism/fallback";
import { ButtonLink, Spinner } from "@/components/m/ui";

export default function LoginPage() {
  return (
    <SessionProvider>
      <Login />
    </SessionProvider>
  );
}

const STEPS = [
  { t: "Connect your NEAR wallet", d: "MyNearWallet or Meteor. Your wallet is your account — no email, no password." },
  { t: "Sign a short message", d: "It proves the account is yours. It is not a transaction and costs nothing." },
  { t: "Add credit when you want answers", d: "Deposit a little testnet NEAR. Each answer is paid from it, and you see the exact cost." },
];

function Login() {
  const { me, loading, refresh } = useSession();
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "completing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState("/console");
  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("next");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the return path after mount
    if (n && n.startsWith("/") && !n.startsWith("//")) setNext(n);
  }, []);

  // Finish a redirect-based sign-in (the wallet returns with #accountId=…&signature=…).
  useEffect(() => {
    if (!window.location.hash.includes("signature=")) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- completing a redirect flow
    setStatus("completing");
    void (async () => {
      try {
        const { completeRedirectSignIn } = await import("@/lib/client/near");
        await completeRedirectSignIn();
        await refresh();
        router.replace("/console");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sign-in failed.");
        setStatus("error");
      }
    })();
  }, [refresh, router]);

  return (
    <div className="m-app grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="flex flex-col px-5 py-6 sm:px-12 sm:py-8">
        <div className="flex items-center justify-between">
          <Logo />
          <Link href="/" className="text-[13px] text-ink-2 hover:text-ink">← Back to home</Link>
        </div>

        <div className="mx-auto my-auto w-full max-w-[460px] py-12">
          <div className="m-label text-g-700">Sign in</div>
          <h1 className="mt-2 font-serif text-[40px] leading-[46px] tracking-[-0.01em] sm:text-[46px] sm:leading-[52px]">Welcome to Metabolic AI.</h1>
          <p className="mt-3 text-[15.5px] leading-[26px] text-ink-2">An AI that pays its own bills. Sign in to ask it questions and pay per answer — or just look around first, no account needed.</p>

          <div className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
            {loading || status === "completing" ? (
              <div className="flex items-center gap-2 py-6 text-[14px] text-muted">
                <Spinner /> {status === "completing" ? "Checking your signature…" : "Loading…"}
              </div>
            ) : me?.user ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-g-50 text-[15px] font-bold text-g-700">{me.user.accountId[0].toUpperCase()}</span>
                  <div>
                    <div className="text-[13px] text-muted">Signed in as</div>
                    <div className="font-mono text-[14px]">{me.user.accountId}</div>
                  </div>
                </div>
                <ButtonLink href={next} variant="green" size="lg" className="w-full">Continue to the console →</ButtonLink>
              </div>
            ) : (
              <>
                <ol className="space-y-4">
                  {STEPS.map((s, i) => (
                    <li key={s.t} className="flex gap-3">
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-g-50 text-[12px] font-bold text-g-700 ring-1 ring-g-200">{i + 1}</span>
                      <div>
                        <div className="text-[14.5px] font-semibold text-ink">{s.t}</div>
                        <div className="text-[13px] leading-5 text-ink-2">{s.d}</div>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="mt-6">
                  <ConnectWallet size="lg" className="w-full [&>button]:w-full" label="Connect NEAR wallet" onDone={() => router.push(next)} />
                </div>
                {error && <p role="alert" className="mt-3 text-[13px] text-sv-text">{error}</p>}
              </>
            )}
          </div>

          {!me?.user && (
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Link href="/console" className="rounded-xl border border-line bg-paper-sunken/60 px-4 py-3 text-[13.5px] hover:border-line-strong">
                <b className="font-semibold text-ink">Just look around →</b>
                <span className="block text-[12.5px] text-muted">See the live dashboard, no sign-in.</span>
              </Link>
              <Link href="/demo" className="rounded-xl border border-line bg-paper-sunken/60 px-4 py-3 text-[13.5px] hover:border-line-strong">
                <b className="font-semibold text-ink">Watch a 90-second demo →</b>
                <span className="block text-[12.5px] text-muted">See it adapt in a safe simulation.</span>
              </Link>
            </div>
          )}

          <details className="mt-6 text-[13px] text-ink-2">
            <summary className="cursor-pointer font-semibold text-ink">No NEAR wallet yet?</summary>
            <p className="mt-2 leading-5">
              Create a free <b>testnet</b> account at{" "}
              <a href="https://testnet.mynearwallet.com" target="_blank" rel="noreferrer" className="font-semibold text-g-700 underline">
                testnet.mynearwallet.com
              </a>
              . Testnet accounts come with free test NEAR, which has no real-world value — perfect for trying Metabolic AI.
            </p>
          </details>
          <details className="mt-2 text-[13px] text-ink-2">
            <summary className="cursor-pointer font-semibold text-ink">Is this safe?</summary>
            <p className="mt-2 leading-5">Signing in only signs a message — it can&apos;t move your funds. Deposits happen only when you approve a transaction in your wallet, and we credit them after checking the NEAR blockchain ourselves.</p>
          </details>
        </div>

        <p className="text-center text-[12px] text-muted">
          By signing in you agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </div>

      <aside className="m-stage hidden flex-col justify-between p-12 lg:flex">
        <div className="relative z-10 mx-auto mt-6 aspect-square w-full max-w-[420px]">
          <OrganismFallback state="ABUNDANCE" />
        </div>
        <div className="relative z-10 mx-auto w-full max-w-[460px] space-y-4">
          <h2 className="font-serif text-[28px] leading-[34px] text-stage-ink">What you get</h2>
          {[
            ["Answers from top AI models", "It picks the best one it can afford for each question."],
            ["The exact price of every answer", "What it cost the business, what you paid, and why that model was chosen."],
            ["A business you can audit", "Its books are hashed onto NEAR. Anyone can verify them."],
          ].map(([t, d]) => (
            <div key={t} className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-g-400" />
              <div>
                <div className="text-[14.5px] font-semibold text-stage-ink">{t}</div>
                <div className="text-[13px] leading-5 text-stage-muted">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
