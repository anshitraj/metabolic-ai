"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useInView } from "motion/react";
import { useLive } from "@/lib/client/live";
import { LogoMark } from "@/components/logo";
import { ProviderMark } from "./provider-mark";
import { cx, StateChip } from "./ui";
import { exampleRouting } from "@/lib/economics/example-routing";

// One clock owns every visual, including the cursor. Pausing freezes the whole demo.
function useTour(
  ref: RefObject<HTMLDivElement | null>,
  count: number,
  duration = 5200,
) {
  const visible = useInView(ref, { amount: 0.25 });
  const reduced = useLive((s) => s.reducedEffects);
  const [position, setPosition] = useState({ step: 0, progress: 0 });
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const done = position.step === count - 1 && position.progress >= 1;
  const [systemReduced, setSystemReduced] = useState(false);
  const playing = !paused && !done && (!(reduced || systemReduced) || started);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setSystemReduced(media.matches);
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    const update = () => setDocumentVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!visible || !documentVisible || !playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.min(now - last, 200) / duration;
      last = now;
      setPosition((p) =>
        p.progress + delta < 1
          ? { ...p, progress: p.progress + delta }
          : p.step < count - 1
            ? { step: p.step + 1, progress: 0 }
            : { ...p, progress: 1 },
      );
    }, 80);
    return () => window.clearInterval(timer);
  }, [visible, documentVisible, playing, count, duration]);
  function select(step: number) {
    setPaused(true);
    setPosition({ step, progress: 0.7 });
  }
  function toggle() {
    if (done) {
      setPosition({ step: 0, progress: 0 });
      setPaused(false);
    } else setPaused(playing);
    setStarted(true);
  }
  function act(step: number) {
    select(step);
  }
  return {
    ...position,
    playing,
    animating: playing && visible && documentVisible,
    done,
    staticPreview: (reduced || systemReduced) && !started,
    select,
    toggle,
    act,
  };
}

const STEPS = [
  {
    title: "Add a little credit",
    description: "A finalized NEAR deposit becomes your prepaid balance.",
  },
  {
    title: "Ask a question",
    description: "The router checks the price before a model starts thinking.",
  },
  {
    title: "Watch it adapt",
    description: "When costs rise, it picks a model the business can afford.",
  },
  {
    title: "Check the books",
    description:
      "Usage is recorded. A receipt commits the ledger hash to NEAR.",
  },
];

function Playback({
  playing,
  done,
  onClick,
  name,
}: {
  playing: boolean;
  done: boolean;
  onClick: () => void;
  name: string;
}) {
  return (
    <button
      type="button"
      className="ml-playback"
      onClick={onClick}
      aria-label={`${done ? "Replay" : playing ? "Pause" : "Play"} ${name}`}
    >
      <span aria-hidden>{done ? "↺" : playing ? "Ⅱ" : "▷"}</span>{" "}
      {done ? "Replay" : playing ? "Pause" : "Play"}
    </button>
  );
}

function DemoCursor({ progress }: { progress: number }) {
  const travel = Math.min(1, progress / 0.24);
  const eased = 1 - Math.pow(1 - travel, 3);
  const click = progress >= 0.25 && progress <= 0.4;
  return (
    <div
      className="ml-demo-cursor"
      aria-hidden
      style={{
        transform: `translate3d(${-eased * 100}px, ${eased * 130}px, 0) scale(${click ? 0.88 : 1})`,
        opacity: progress < 0.65 ? 1 : 0,
      }}
    >
      <span
        className="ml-click-ring"
        style={{
          opacity: click ? 0.7 * (1 - (progress - 0.25) / 0.15) : 0,
          transform: `scale(${0.3 + Math.max(0, progress - 0.25) * 7})`,
        }}
      />
      <svg width="27" height="32" viewBox="0 0 27 32">
        <path
          d="M3 2 23 20l-10 1-4 8Z"
          fill="var(--m-ink)"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function ProductTour() {
  const ref = useRef<HTMLDivElement>(null);
  const tour = useTour(ref, 4);
  const { step, progress } = tour;
  const action = progress >= 0.3;
  const funded = step > 0 || action;
  const stressed = step > 2 || (step === 2 && action);
  const route = exampleRouting(stressed);
  const state = "ABUNDANCE";
  return (
    <div ref={ref} className="ml-tour" data-testid="product-tour" data-playing={tour.animating}>
      <div className="ml-browser-bar">
        <div className="ml-window-dots" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <span>metabolic / command center</span>
        <span className="ml-example">Interactive example</span>
      </div>
      <div className="ml-tour-body">
        <aside className="ml-tour-sidebar" aria-hidden>
          <LogoMark size={25} />
          <span className="mt-7">Overview</span>
          <span className={step === 1 ? "active" : ""}>Workspace</span>
          <span className={step === 0 ? "active" : ""}>Treasury</span>
          <span className={step === 2 ? "active" : ""}>Stress Lab</span>
          <span className={step === 3 ? "active" : ""}>Receipts</span>
          <div className="mt-auto text-g-700">● NEAR testnet</div>
        </aside>
        <div className="ml-tour-content">
          <div className="ml-tour-heading">
            <div>
              <span className="m-label text-muted">
                A tiny, self-funded business
              </span>
              <h3>
                {
                  [
                    "Start with a little fuel.",
                    "Good answers. Clear costs.",
                    "Prices change. It adjusts.",
                    "Don't trust it. Check it.",
                  ][step]
                }
              </h3>
            </div>
            <StateChip state={state} />
          </div>
          <div className="ml-tour-stats">
            <div>
              <span>Your prepaid credit</span>
              <strong>
                {funded ? (step > 1 ? "$4.98" : "$5.00") : "$0.00"}
              </strong>
            </div>
            <div>
              <span>Business margin</span>
              <strong>
                {Math.round(route.models[route.selected].marginBp / 100)}%
                <small> after compute</small>
              </strong>
            </div>
            <div>
              <span>Selected tier</span>
              <strong className="!text-g-700">
                {route.models[route.selected].tier}
              </strong>
            </div>
          </div>
          <div className="ml-tour-journey" aria-hidden>
            {["🪙 Credit", "💬 Request", "🛡️ Policy", "🧾 Receipt"].map((label, i) => <span key={label} className={i === step ? "active" : i < step ? "complete" : ""}>{label}{i < 3 && <b>→</b>}</span>)}
          </div>
          <div className="ml-demo-workspace" key={step}>
            <div className="ml-demo-primary">
              <div className="ml-scene-token" aria-hidden>{["🪙", "✨", "🛡️", "🧾"][step]}</div>
              {step === 0 ? (
                <>
                  <div className="ml-demo-card-label">Your first deposit</div>
                  <div className="ml-demo-amount">
                    A little NEAR.
                    <br />
                    <em>A place to start.</em>
                  </div>
                  <p>
                    Sign with your wallet. Credit arrives after the transaction
                    is finalized.
                  </p>
                  <button
                    className={cx("ml-demo-action", action && "is-complete")}
                    onClick={() => tour.act(0)}
                    type="button"
                  >
                    {action ? "✓ Deposit confirmed" : "Confirm example deposit"}
                  </button>
                  <div className="ml-demo-fine">
                    Example conversion only · no wallet transaction
                  </div>
                </>
              ) : step === 1 ? (
                <>
                  <div className="ml-demo-card-label">AI workspace</div>
                  <div className="ml-chat-prompt">
                    Explain a safety reserve in one sentence.
                  </div>
                  <div className={cx("ml-chat-answer", action && "is-ready")}>
                    <ProviderMark provider="gemini" size={21} />
                    <p>
                      {action
                        ? "A safety reserve is money the business sets aside so an expensive answer can't spend its last dollar."
                        : "The router is checking model costs…"}
                    </p>
                  </div>
                  <button
                    className="ml-demo-action"
                    type="button"
                    onClick={() => tour.act(1)}
                  >
                    {action ? "✓ Answer received" : "Send example request ↑"}
                  </button>
                  <div className="ml-demo-fine">
                    Illustrative answer · no paid AI request
                  </div>
                </>
              ) : step === 2 ? (
                <>
                  <div className="ml-demo-card-label">
                    Stress Lab · isolated example
                  </div>
                  <div className="ml-demo-amount">
                    What if compute
                    <br />
                    <em>costs 2.4× more?</em>
                  </div>
                  <p>
                    {stressed ? "Premium falls to −20% margin. Standard keeps 44%, so the business can keep answering." : "Apply the change to see the router protect its margin with a different model."}
                  </p>
                  <button
                    className={cx("ml-demo-action", action && "is-complete")}
                    type="button"
                    onClick={() => tour.act(2)}
                  >
                    {action
                      ? "✓ Switched to Standard"
                      : "Raise example costs ↗"}
                  </button>
                  <div className="ml-demo-fine">
                    Real policy concepts · illustrative figures
                  </div>
                </>
              ) : (
                <>
                  <div className="ml-demo-card-label">Economic receipt</div>
                  <div className="ml-receipt-lines">
                    <span>
                      Revenue <b>$0.0200</b>
                    </span>
                    <span>
                      Compute <b>$0.0112</b>
                    </span>
                    <span>
                      Margin <b className="text-g-700">44%</b>
                    </span>
                  </div>
                  <button
                    className={cx("ml-demo-action", action && "is-complete")}
                    type="button"
                    onClick={() => tour.act(3)}
                  >
                    {action ? "✓ Hashes match" : "Compare receipt hashes →"}
                  </button>
                  <div className="ml-demo-fine">
                    Illustrative receipt · verify a real one in the app
                  </div>
                </>
              )}
              <DemoCursor progress={progress} />
            </div>
            <div className="ml-demo-models">
              <div className="ml-demo-card-label">The model desk</div>
              {route.models.map((m, i) => (
                <div
                  className={cx(
                    "ml-demo-model",
                    route.selected === i && "selected",
                    m.marginBp < 3000 && "unavailable",
                  )}
                  key={m.name}
                >
                  <ProviderMark provider={m.provider} size={28} />
                  <div>
                    <strong>{m.name}</strong>
                    <span>
                      {m.tier} · {Math.round(m.marginBp / 100)}% margin
                    </span>
                  </div>
                  <span className="ml-model-check" aria-hidden>
                    {m.marginBp < 3000
                      ? "×"
                      : route.selected === i
                        ? "✓"
                        : ""}
                  </span>
                </div>
              ))}
              <div className="ml-routing-reason">
                <span className="m-label">Why this model?</span>
                <p>
                  {stressed
                    ? "Standard clears the 30% example floor. The business stays healthy by changing its model."
                    : "Premium fits the current budget and margin policy."}
                </p>
              </div>
            </div>
          </div>
          <div
            className="ml-tour-caption"
            aria-live={tour.playing ? "off" : "polite"}
          >
            <span>0{step + 1} / 04</span>
            {STEPS[step].description}
          </div>
        </div>
      </div>
      <div className="ml-tour-controls">
        <div className="ml-tour-steps" aria-label="Product walkthrough steps">
          {STEPS.map((s, i) => (
            <button
              type="button"
              key={s.title}
              onClick={() => tour.select(i)}
              aria-pressed={step === i}
            >
              <span className="ml-step-track">
                <i
                  style={{
                    transform: `scaleX(${i < step ? 1 : i === step ? progress : 0})`,
                  }}
                />
              </span>
              <span>
                <small>0{i + 1}</small>
                {s.title}
              </span>
            </button>
          ))}
        </div>
        <Playback
          playing={tour.playing}
          done={tour.done}
          onClick={tour.toggle}
          name="product walkthrough"
        />
      </div>
    </div>
  );
}

const CODE_STEPS = [
  {
    name: "Create a pass",
    code: "# Developer API → Spend Passes\n\nName          Research allowance\nAgent         Research agent\nTotal budget  $5.00\nPer request   $0.02 maximum\nExpiry        You choose\n\n→ Create pass and agent key",
    result:
      "Set a total allowance and a maximum charge per request in Developers.",
    note: "Example settings · create your pass in the console",
  },
  {
    name: "Ask the API",
    code: 'curl "$METABOLIC/api/v1/inference" \\\n  -H "Authorization: Bearer $AGENT_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"messages":[{"role":"user",\n       "content":"What is a safety reserve?"}],\n       "max_output_tokens":128}\'',
    result:
      "The bound key carries the pass. The server checks permissions before routing.",
    note: "A real endpoint · use your own app URL and agent key",
  },
  {
    name: "Read the reason",
    code: '// Every answer has an economic trail.\n\nmodel     → Gemini Flash\ntier      → Standard\nAI cost   → $0.0112\nyou pay   → $0.0200\nmargin    → 44%\n\n"Premium falls below the margin floor."',
    result:
      "See the selected model, provider usage, customer charge and routing explanation.",
    note: "Illustrative response summary · not a live request",
  },
  {
    name: "Stop the spend",
    code: "Your agent key\n      ↓\nSpend Pass revoked\n      ↓\nHTTP 403 · PASS_REVOKED\n\nNo new inference admitted.\nPreviously admitted work may finish.",
    result:
      "Revoke in one click. New requests stop at the server before they reach a provider.",
    note: "Example outcome · this demo never creates or revokes a key",
  },
];

export function ApiTour() {
  const ref = useRef<HTMLDivElement>(null);
  const tour = useTour(ref, 4, 6200);
  const item = CODE_STEPS[tour.step];
  const chars = tour.staticPreview
    ? item.code.length
    : Math.min(
        item.code.length,
        Math.ceil((item.code.length * tour.progress) / 0.55),
      );
  return (
    <div ref={ref} className="ml-api-tour" data-testid="api-tour">
      <div className="ml-api-top">
        <div className="ml-window-dots" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <span>agent / metabolic</span>
        <span>Example session</span>
      </div>
      <div className="ml-api-screen">
        <pre aria-hidden>
          {item.code.slice(0, chars)}
          <span className="ml-terminal-caret">▌</span>
        </pre>
        <span className="sr-only">{item.code}</span>
        <div
          className="ml-api-result"
          aria-live={tour.playing ? "off" : "polite"}
        >
          <span aria-hidden>↳</span>
          {item.result}
        </div>
        <p>{item.note}</p>
      </div>
      <div className="ml-api-bottom">
        <div className="ml-api-tabs" aria-label="API walkthrough steps">
          {CODE_STEPS.map((s, i) => (
            <button
              type="button"
              key={s.name}
              onClick={() => tour.select(i)}
              aria-pressed={tour.step === i}
            >
              {s.name}
            </button>
          ))}
        </div>
        <Playback
          playing={tour.playing}
          done={tour.done}
          onClick={tour.toggle}
          name="API walkthrough"
        />
      </div>
    </div>
  );
}

export function SpendPassPreview() {
  const [used, setUsed] = useState(1.4);
  const [revoked, setRevoked] = useState(false);
  const [message, setMessage] = useState(
    "Try sending a $0.02 example request.",
  );
  const remaining = Math.max(0, 1.5 - used);
  return (
    <div className="ml-pass-preview">
      <div className="ml-pass-top">
        <div className="ml-pass-agent">
          <ProviderMark provider="gemini" size={32} />
          <div>
            <strong>Research agent</strong>
            <span>Spend Pass · example</span>
          </div>
        </div>
        <span
          className={cx(
            "ml-pass-status",
            (revoked || remaining < 0.019) && "is-stopped",
          )}
        >
          {revoked ? "Revoked" : remaining < 0.019 ? "At limit" : "Active"}
        </span>
      </div>
      <div className="ml-pass-amount">
        ${used.toFixed(2)} <span>of $1.50 used</span>
      </div>
      <div className="ml-pass-meter">
        <i style={{ width: `${(used / 1.5) * 100}%` }} />
      </div>
      <div className="ml-pass-limits">
        <span>
          Total allowance <b>$1.50</b>
        </span>
        <span>
          Per request <b>$0.02 max</b>
        </span>
        <span>
          Remaining <b>${remaining.toFixed(2)}</b>
        </span>
      </div>
      <p
        role="status"
        className={cx(
          "ml-pass-message",
          (revoked || remaining < 0.019) && "is-stopped",
        )}
      >
        {message}
      </p>
      <div className="ml-pass-actions">
        <button
          type="button"
          onClick={() => {
            if (revoked)
              setMessage(
                "Blocked: this Spend Pass was revoked. No provider call.",
              );
            else if (remaining < 0.019)
              setMessage(
                "Blocked: the total allowance is used up. No provider call.",
              );
            else {
              setUsed((v) => Math.min(1.5, Math.round((v + 0.02) * 100) / 100));
              setMessage(
                "Request allowed. $0.02 charged to this example pass.",
              );
            }
          }}
        >
          Send example request ↗
        </button>
        <button
          type="button"
          disabled={revoked}
          onClick={() => {
            setRevoked(true);
            setMessage(
              "Pass revoked. New requests are blocked before inference.",
            );
          }}
        >
          Revoke
        </button>
      </div>
      <button
        type="button"
        className="ml-pass-reset"
        onClick={() => {
          setUsed(1.4);
          setRevoked(false);
          setMessage("Try sending a $0.02 example request.");
        }}
      >
        ↺ Reset example
      </button>
      <p className="ml-demo-fine">
        Try it here. No key, credits or wallet needed.
      </p>
    </div>
  );
}
