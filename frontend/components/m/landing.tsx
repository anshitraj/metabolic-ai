"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { OperatingState } from "@/lib/economics/types";
import { useLive, useRealFeed, STATE_META } from "@/lib/client/live";
import { api } from "@/lib/client/api";
import { big, formatBp, formatUsd } from "@/lib/economics/money";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { OrganismStage } from "@/components/organism/stage";
import { OrganismFallback } from "@/components/organism/fallback";
import { ReceiptCard, type ReceiptDTO } from "./receipt";
import { ApiTour, ProductTour, SpendPassPreview } from "./product-tour";
import { ProviderMark } from "./provider-mark";
import { RoutingPlayground } from "./routing-playground";
import { MotionPreview } from "./motion-preview";
import { LandingMotion } from "./landing-motion";
import { ButtonLink, StateChip, cx } from "./ui";
const STATES: {
  state: OperatingState;
  title: string;
  description: string;
  action: string;
}[] = [
  {
    state: "ABUNDANCE",
    title: "Room to think.",
    description:
      "Funds and margins are healthy. Stronger models can do their best work.",
    action: "Premium models allowed",
  },
  {
    state: "DEFENSIVE",
    title: "Spend more carefully.",
    description:
      "Costs are squeezing the margin. The router narrows its options to protect the business.",
    action: "Tighter model selection",
  },
  {
    state: "SURVIVAL",
    title: "Protect the reserve.",
    description:
      "Funds are too close to the safety reserve. Costly work pauses before the last dollar goes.",
    action: "Costly work paused",
  },
  {
    state: "RECOVERY",
    title: "Find its feet again.",
    description:
      "New funding gives it breathing room. Capabilities return gradually as conditions improve.",
    action: "Gradual return to service",
  },
];
const QUESTIONS = [
  [
    "What exactly is Metabolic AI?",
    "An AI service with a visible balance sheet. Customers prepay for answers, models cost money to run, and a fixed policy adjusts model selection as the business’s finances change. You can inspect the costs, decisions and accounting receipts.",
  ],
  [
    "Can I try it without a wallet?",
    "Yes. The interactive examples on this page and the guided demo need no wallet. To make real AI requests, sign in with a NEAR wallet and add testnet credit. Testnet tokens have no monetary value.",
  ],
  [
    "What do Healthy, Defensive and Survival mean?",
    "They describe the business’s financial condition. Healthy allows stronger models; Defensive tightens spending; Survival protects the safety reserve and pauses costly work. Recovery gradually restores service after conditions improve. The Stress Lab lets you explore these states safely.",
  ],
  [
    "Does an AI control the treasury?",
    "A deterministic, versioned policy engine controls admission and model routing. Language models answer questions; they do not set spending rules. NEAR verifies deposits and stores receipt commitments. Spend Pass limits are enforced by the application server.",
  ],
  [
    "Does one Gemini key work with multiple models?",
    "Yes. A single Google Gemini API key can access multiple models when that provider account has access and quota. Metabolic can route among Pro, Flash and Flash-Lite. Claude, DeepSeek and hosted Llama each need their own provider credentials. OpenAI / ChatGPT is not currently a connected inference provider.",
  ],
  [
    "What does a Spend Pass actually limit?",
    "A pass binds an agent key to a total allowance, a maximum customer charge per request, an expiry and optional model restrictions. It draws from your prepaid credits. You can revoke it to block new requests. It is not a wallet key, and its limits are enforced by the server, not a NEAR contract.",
  ],
  [
    "What is real, and what is an example?",
    "Console deposits, AI usage, routing decisions and finalized receipts use the actual testnet service. The homepage demos are interactive illustrations. The Stress Lab and guided demo run isolated simulations using the policy engine. None of those examples changes your real balance.",
  ],
  [
    "What does the on-chain receipt prove?",
    "It lets you compare an accounting record’s hash with a commitment stored on NEAR. A match shows the record agrees with that commitment. It does not prove that an AI provider was paid; provider expenses are recorded and reconciled offchain.",
  ],
];

export function Landing() {
  useRealFeed();
  const overview = useLive((s) => s.overview);
  const effectsReduced = useLive((s) => s.reducedEffects);
  const [receipt, setReceipt] = useState<ReceiptDTO | null>(null);
  const [preview, setPreview] = useState<OperatingState | null>(null);
  const [providers, setProviders] = useState<
    { provider: string; configured: boolean }[] | null
  >(null);
  const [providerError, setProviderError] = useState(false);
  useEffect(() => {
    api<{ receipts: ReceiptDTO[] }>("/api/receipts")
      .then((r) =>
        setReceipt(r.receipts.find((x) => x.status === "finalized") ?? null),
      )
      .catch(() => {});
    api<{ providers: { provider: string; configured: boolean }[] }>(
      "/api/public/config",
    )
      .then((c) => setProviders(c.providers))
      .catch(() => setProviderError(true));
  }, []);
  return (
    <div className="m-app ml-landing" data-effects={effectsReduced ? "low" : "full"}>
      <LandingMotion />
      <Nav />
      <main id="main-content">
        <section className="ml-hero ml-container">
          <div className="ml-hero-copy">
            <div className="ml-eyebrow">
              <span className="m-live-dot" /> An AI with its own economics
            </div>
            <h1>
              Built to think.
              <br />
              Smart enough
              <br />
              <em className="ml-survive-word">
                to survive.
                <span aria-hidden className="ml-word-orbit" />
              </em>
            </h1>
            <p>
              Good answers cost money. Metabolic earns from requests, watches
              its treasury, and switches models when the numbers change. You see
              every decision.
            </p>
            <div className="ml-hero-actions">
              <ButtonLink href="/console" size="lg" variant="green">
                Meet Metabolic <span aria-hidden>↗</span>
              </ButtonLink>
              <a className="ml-text-link" href="#how">
                <span className="ml-play-circle" aria-hidden>
                  ▷
                </span>{" "}
                See it in action
              </a>
            </div>
            <div className="ml-hero-note">
              <span>Built on NEAR testnet</span>
              <span>No wallet needed to explore</span>
            </div>
            <div className="ml-hero-logos" aria-label="Model providers supported by Metabolic">
              {[{ provider: "gemini", name: "Gemini" }, { provider: "anthropic", name: "Claude" }, { provider: "deepseek", name: "DeepSeek" }].map((p) => <span key={p.provider}><ProviderMark provider={p.provider} size={22} /><span>{p.name}</span></span>)}
              <small>Your models. One spending policy.</small>
            </div>
          </div>
          <div className="ml-hero-specimen">
            <div className="ml-specimen-top">
              <span>FIG. 01 — A LIVING BALANCE SHEET</span>
              <span>Drag to rotate ↗</span>
            </div>
            <OrganismStage
              overview={overview}
              previewState={preview}
              className="ml-hero-stage"
            />
            <div className="ml-specimen-bottom">
              <span>Economics, made visible.</span>
              <span>ECONOMICS / IN MOTION</span>
            </div>
            <div
              className="ml-mood-picker"
              role="group"
              aria-label="Preview organism states"
            >
              {(
                [
                  null,
                  "ABUNDANCE",
                  "DEFENSIVE",
                  "SURVIVAL",
                  "RECOVERY",
                ] as (OperatingState | null)[]
              ).map((s) => (
                <button
                  key={s ?? "live"}
                  type="button"
                  aria-pressed={preview === s}
                  onClick={() => setPreview(s)}
                  className={cx(preview === s && "active")}
                >
                  {s ? STATE_META[s].label : "● Live"}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section
          className="ml-container ml-ledger-strip"
          aria-label="Live business figures"
        >
          <div className="ml-ledger-source">
            <span className="m-label text-g-700">The open ledger</span>
            <span>Live figures, from the service.</span>
          </div>
          <dl>
            {[
              ["Treasury", overview ? formatUsd(big(overview.treasury)) : "—"],
              [
                "Revenue earned",
                overview ? formatUsd(big(overview.revenueTotal)) : "—",
              ],
              [
                "Margin · last hour",
                overview ? formatBp(overview.rollingMarginBp) : "—",
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="how" className="ml-container ml-section">
          <div className="ml-section-heading">
            <div>
              <span className="ml-eyebrow">01 / The everyday loop</span>
              <h2>
                A little fuel.
                <br />A lot of <em>self-preservation.</em>
              </h2>
            </div>
            <p>
              Fund it. Ask it something. Change the conditions.
              <br className="hidden sm:block" /> Watch the whole business
              respond.
            </p>
          </div>
          <ProductTour />
          <div className="ml-section-foot">
            <span>Click any step to explore at your own pace.</span>
            <Link href="/demo">
              Try the full guided simulation <span aria-hidden>↗</span>
            </Link>
          </div>
        </section>

        <section className="ml-flow-section">
          <div className="ml-container">
            <div className="ml-section-heading">
              <div>
                <span className="ml-eyebrow">Follow the thinking</span>
                <h2>
                  The best model?
                  <br />
                  <em>The one that fits.</em>
                </h2>
              </div>
              <p>
                Raise the example costs. Follow the request.
                <br className="hidden sm:block" /> Every route has a financial
                reason.
              </p>
            </div>
            <RoutingPlayground />
          </div>
        </section>

        <section className="ml-provider-section">
          <div className="ml-container">
            <div className="ml-section-heading">
              <div>
                <span className="ml-eyebrow">
                  Many models. One set of rules.
                </span>
                <h2>
                  Different minds.
                  <br />
                  <em>The same discipline.</em>
                </h2>
              </div>
              <p>
                The router chooses among configured models.
                <br className="hidden sm:block" /> One Gemini key can power
                several tiers.
              </p>
            </div>
            <div className="ml-provider-grid">
              {[
                {
                  id: "gemini",
                  name: "Gemini",
                  note: "Pro · Flash · Flash-Lite",
                },
                { id: "anthropic", name: "Claude", note: "Anthropic models" },
                {
                  id: "deepseek",
                  name: "DeepSeek",
                  note: "Cost-efficient reasoning",
                },
                { id: "llama", name: "Llama", note: "Hosted open models" },
                {
                  id: "openai",
                  name: "ChatGPT / OpenAI",
                  note: "Future provider",
                },
              ].map((p) => {
                const configured = providers?.find(
                  (x) => x.provider === p.id,
                )?.configured;
                return (
                  <div key={p.id} className="ml-provider-tile">
                    <div className="ml-provider-icon">
                      <ProviderMark provider={p.id} size={34} />
                    </div>
                    <h3>{p.name}</h3>
                    <p>{p.note}</p>
                    <span
                      className={cx(
                        "ml-provider-status",
                        configured && "connected",
                      )}
                    >
                      {p.id === "openai"
                        ? "Not integrated"
                        : !providers
                          ? providerError
                            ? "Status unavailable"
                            : "Checking status…"
                          : configured
                            ? "Key configured"
                            : "Needs provider key"}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="ml-provider-disclaimer">
              Logos identify providers, not endorsements. A configured key still
              needs model access and quota.{" "}
              <Link href="/console/models">
                See models & connection checks ↗
              </Link>
            </p>
          </div>
        </section>

        <section className="ml-container ml-section ml-pass-section">
          <div className="ml-feature-copy">
            <span className="ml-eyebrow">02 / A key with boundaries</span>
            <h2>
              Give your agent
              <br />
              an allowance.
              <br />
              <em>Keep the wallet.</em>
            </h2>
            <p>
              A Spend Pass says how much an agent can spend, how much one
              request can cost, and when access expires. Its key can call the
              API. It can’t sign wallet transactions.
            </p>
            <ul className="ml-feature-list">
              <li>
                <span>01</span>
                <div>
                  <strong>A total budget you choose</strong>
                  <p>Each completed request uses a little of the allowance.</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Every request checked first</strong>
                  <p>The server reserves the maximum before admitting work.</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Stop new work in one click</strong>
                  <p>Revoke the pass. The next request is blocked.</p>
                </div>
              </li>
            </ul>
            <ButtonLink href="/console/developers" variant="ink" size="lg">
              Create a Spend Pass ↗
            </ButtonLink>
          </div>
          <div className="ml-pass-display">
            <span className="ml-display-label">
              A SMALL, CLICKABLE EXPERIMENT
            </span>
            <SpendPassPreview />
            <p className="ml-pass-caption">
              Tap “Send” a few times. Then revoke it.
              <br />
              The limits are the point.
            </p>
          </div>
        </section>

        <section className="ml-states-section">
          <div className="ml-container">
            <div className="ml-section-heading">
              <div>
                <span className="ml-eyebrow">03 / Read the room</span>
                <h2>
                  Four states.
                  <br />
                  <em>No mystery.</em>
                </h2>
              </div>
              <p>
                The organism is a financial signal.
                <br className="hidden sm:block" /> Its color changes for a
                reason.
              </p>
            </div>
            <div className="ml-state-grid">
              {STATES.map((s, i) => (
                <button
                  type="button"
                  key={s.state}
                  className="ml-state-card"
                  onClick={() => setPreview(s.state)}
                  aria-pressed={preview === s.state}
                >
                  <div className="ml-state-art">
                    <OrganismFallback state={s.state} filaments={false} />
                    <span>0{i + 1}</span>
                  </div>
                  <StateChip state={s.state} />
                  <h3>{s.title}</h3>
                  <p>{s.description}</p>
                  <span className="ml-state-action">{s.action}</span>
                </button>
              ))}
            </div>
            <div className="ml-state-explore">
              <p>
                Want to see the tipping point? Raise costs or drain the
                simulated treasury.
              </p>
              <ButtonLink href="/console/stress-lab" variant="stage" size="lg">
                Explore the Stress Lab ↗
              </ButtonLink>
            </div>
          </div>
        </section>

        <section className="ml-container ml-section">
          <div className="ml-section-heading">
            <div>
              <span className="ml-eyebrow">04 / Built for builders</span>
              <h2>
                Your agent.
                <br />
                <em>A more thoughtful API.</em>
              </h2>
            </div>
            <p>
              One endpoint. Automatic routing.
              <br className="hidden sm:block" /> An explanation that travels
              with the answer.
            </p>
          </div>
          <ApiTour />
          <div className="ml-section-foot">
            <span>
              Spend Pass rules are enforced by the server. Deposits and receipt
              commitments use NEAR.
            </span>
            <Link href="/console/developers">
              Open the developer console ↗
            </Link>
          </div>
        </section>

        <section className="ml-container ml-proof-section">
          <div>
            <span className="ml-eyebrow">05 / Proof, in plain sight</span>
            <h2>
              The books are open.
              <br />
              <em>Bring your own trust.</em>
            </h2>
            <p>
              Every request leaves an accounting trail. Economic receipts commit
              an interval’s ledger hash to NEAR, so you can compare the record
              yourself.
            </p>
            <ButtonLink href="/verify" variant="green" size="lg">
              Verify a receipt ↗
            </ButtonLink>
          </div>
          <div className="ml-proof-card">
            <div className="ml-proof-heading">
              <span className="m-label">A record you can inspect</span>
              <span>↗ NEAR</span>
            </div>
            {receipt ? (
              <ReceiptCard r={receipt} />
            ) : (
              <div className="ml-proof-empty">
                <svg
                  width="44"
                  height="44"
                  viewBox="0 0 40 40"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M10 4h20v32l-5-3-5 3-5-3-5 3V4Z"
                    stroke="currentColor"
                  />
                  <path d="M15 13h10M15 20h10" stroke="currentColor" />
                </svg>
                <h3>Receipts live here.</h3>
                <p>
                  The latest finalized receipt appears when the service commits
                  one on NEAR.
                </p>
                <Link href="/console/receipts">
                  Inspect the receipt ledger ↗
                </Link>
              </div>
            )}
            <p className="ml-proof-note">
              A matching commitment verifies the accounting record. It does not
              prove an AI provider was paid.
            </p>
          </div>
        </section>

        <section className="ml-container ml-film-section">
          <div className="ml-section-heading">
            <div>
              <span className="ml-eyebrow">Motion with a meaning</span>
              <h2>
                It has a survival instinct.
                <br />
                <em>You can watch it work.</em>
              </h2>
            </div>
            <p>
              Four financial states, made visible.
              <br />
              Play, pause and explore at your own pace.
            </p>
          </div>
          <MotionPreview />
          <div className="ml-film-caption">
            <span>Illustrative motion study · real demo in the Stress Lab</span>
            <Link href="/demo">Open the guided app demo ↗</Link>
          </div>
        </section>

        <section id="faq" className="ml-container ml-section ml-faq">
          <div>
            <span className="ml-eyebrow">A few good questions</span>
            <h2>
              Clear answers.
              <br />
              <em>Fewer unknowns.</em>
            </h2>
            <p>Still curious? The whole project is open.</p>
            <a
              href="https://github.com/anshitraj/metabolic-ai"
              target="_blank"
              rel="noreferrer"
              className="ml-text-link"
            >
              Read the source ↗
            </a>
          </div>
          <div className="ml-faq-items">
            {QUESTIONS.map(([q, a], i) => (
              <details key={q} name="landing-faq">
                <summary>
                  <span className="ml-faq-number">0{i + 1}</span>
                  <span>{q}</span>
                  <span className="ml-faq-plus" aria-hidden>
                    +
                  </span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
