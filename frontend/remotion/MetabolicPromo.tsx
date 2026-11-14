import {
  AbsoluteFill,
  Html5Audio,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BRAND as B, useBrandFont } from "./brand";
import { MetabolicCore } from "./MetabolicCore";

export const PROMO_FRAMES = 900;
export const PROMO_FPS = 30;
const clips = [
  {
    start: 90,
    duration: 150,
    label: "01 / MEET THE BUSINESS",
    title: "Every answer has a cost.",
    subtitle: "See its funds, model choice and routing reason together.",
    clip: "overview",
    badge: "NEAR TESTNET · ACTUAL APP",
  },
  {
    start: 240,
    duration: 180,
    label: "02 / CHANGE THE CONDITIONS",
    title: "Costs rise. It adapts.",
    subtitle: "The Stress Lab runs the policy in an isolated simulation.",
    clip: "stress",
    badge: "SIMULATED ECONOMY",
  },
  {
    start: 420,
    duration: 180,
    label: "03 / PROTECT THE RESERVE",
    title: "Survival is a spending rule.",
    subtitle: "Low funds pause costly work before the last dollar goes.",
    clip: "survival",
    badge: "SIMULATED ECONOMY",
  },
  {
    start: 600,
    duration: 180,
    label: "04 / CHECK THE RECORD",
    title: "A receipt you can verify.",
    subtitle: "Compare the accounting hash with its commitment on NEAR.",
    clip: "receipt",
    badge: "ACTUAL TESTNET RECEIPT",
  },
];

function Mark({ size = 54 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28">
      <circle cx="14" cy="14" r="14" fill={B.mint} />
      <ellipse
        cx="14"
        cy="14"
        rx="5.5"
        ry="10"
        transform="rotate(40 14 14)"
        fill="none"
        stroke={B.dark}
        strokeWidth="2"
      />
      <ellipse
        cx="14"
        cy="14"
        rx="5.5"
        ry="10"
        transform="rotate(-40 14 14)"
        fill="none"
        stroke={B.dark}
        strokeWidth="2"
      />
      <circle cx="14" cy="14" r="3.5" fill={B.dark} />
    </svg>
  );
}

function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        alignItems: "center",
        color: dark ? B.paper : B.ink,
        fontSize: 42,
        fontWeight: 800,
        letterSpacing: -3,
      }}
    >
      <Mark />
      metabolic<span style={{ color: B.mint, marginLeft: -14 }}>.</span>
    </div>
  );
}

function Intro({ ending = false }: { ending?: boolean }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const portrait = height > width * 1.2,
    square = height === width;
  const pad = portrait ? 75 : square ? 65 : 95;
  const headline = ending
    ? ["Think clearly.", "Spend carefully.", "Keep going."]
    : ["Built to think.", "Smart enough", "to survive."];
  const fontSize = portrait ? 99 : square ? 88 : 112;
  const coreW = portrait ? width : square ? width * 0.7 : width * 0.48;
  const coreH = portrait ? height * 0.48 : square ? height * 0.58 : height;
  return (
    <AbsoluteFill
      style={{
        background: B.dark,
        color: B.paper,
        padding: pad,
        overflow: "hidden",
      }}
    >
      <Wordmark dark />
      <div
        style={{
          position: "absolute",
          right: portrait ? 0 : square ? -90 : -15,
          bottom: portrait ? 100 : square ? -25 : 0,
          width: coreW,
          height: coreH,
          opacity: square ? 0.6 : 1,
        }}
      >
        <MetabolicCore width={coreW} height={coreH} />
      </div>
      <div
        style={{
          position: "relative",
          marginTop: portrait ? 150 : square ? 110 : 130,
          zIndex: 1,
        }}
      >
        {headline.map((text, i) => {
          const enter = spring({
            frame: frame - i * 7,
            fps,
            config: { damping: 22, stiffness: 125 },
          });
          return (
            <div key={text} style={{ overflow: "hidden" }}>
              <div
                style={{
                  fontSize,
                  fontWeight: 800,
                  lineHeight: 1.12,
                  letterSpacing: -fontSize * 0.065,
                  color: i === 2 ? B.mint : B.paper,
                  transform: `translateY(${(1 - enter) * 105}%)`,
                  opacity: enter,
                }}
              >
                {text}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "relative",
          marginTop: 44,
          fontSize: portrait ? 33 : 30,
          lineHeight: 1.55,
          maxWidth: portrait ? 820 : 900,
          opacity: interpolate(frame, [25, 42], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {ending
          ? "Explore the demo. Inspect the decisions."
          : "An AI service with a balance sheet.\nBuilt on NEAR testnet."}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: pad,
          left: pad,
          right: pad,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 20,
          fontSize: portrait ? 23 : 22,
          color: B.pale,
        }}
      >
        {ending ? (
          <span
            style={{ borderBottom: `2px solid ${B.mint}`, paddingBottom: 9 }}
          >
            github.com/anshitraj/metabolic-ai ↗
          </span>
        ) : (
          <span>REAL APP · SIMULATIONS LABELLED</span>
        )}
        <span style={{ fontWeight: 600 }}>Metabolic AI</span>
      </div>
    </AbsoluteFill>
  );
}

function AppShot({ shot }: { shot: (typeof clips)[number] }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const portrait = height > width * 1.2,
    square = width === height;
  const wide = !portrait && !square;
  const pad = portrait ? 64 : square ? 52 : 80;
  const enter = spring({ frame, fps, config: { damping: 24, stiffness: 130 } });
  const isReceipt = shot.clip === "receipt";
  const recording = staticFile(
    `films/assets/${shot.clip}-${portrait ? "mobile" : "desktop"}.mp4`,
  );
  const top = portrait ? 540 : square ? 345 : 210;
  const screenHeight = portrait
    ? height - top - 205
    : square
      ? height - top - 155
      : height - top - 110;
  return (
    <AbsoluteFill style={{ background: B.paper, color: B.ink, padding: pad }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Wordmark />
        <span
          style={{
            fontSize: portrait ? 18 : 19,
            color: B.green,
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          {shot.label}
        </span>
      </div>
      <h1
        style={{
          fontSize: portrait ? 78 : square ? 65 : 77,
          lineHeight: 1.08,
          fontWeight: 800,
          letterSpacing: -4,
          margin: `${portrait ? 100 : wide ? 155 : 53}px 0 0`,
          transform: `translateY(${(1 - enter) * 25}px)`,
          opacity: enter,
          maxWidth: wide ? 535 : portrait ? 900 : undefined,
        }}
      >
        {shot.title}
      </h1>
      <p
        style={{
          marginTop: 25,
          fontSize: portrait ? 31 : square ? 26 : 30,
          color: B.muted,
          lineHeight: 1.5,
          maxWidth: wide ? 500 : portrait ? 850 : undefined,
        }}
      >
        {shot.subtitle}
      </p>
      <div
        style={{
          position: "absolute",
          top,
          left: wide ? 700 : pad,
          right: pad,
          height: screenHeight,
          borderRadius: portrait ? 34 : 22,
          overflow: "hidden",
          border: `1px solid ${B.line}`,
          background: "white",
          boxShadow: "0 25px 60px rgba(6,48,31,.09)",
          transform: `translateY(${(1 - enter) * 32}px) scale(${0.98 + enter * 0.02})`,
        }}
      >
        <OffthreadVideo
          src={recording}
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: square ? "cover" : "contain",
            objectPosition: "top center",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          bottom: portrait ? 105 : 48,
          left: pad,
          right: pad,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 20,
          fontSize: portrait ? 23 : 19,
        }}
      >
        <span
          style={{
            padding: "11px 18px",
            background: isReceipt
              ? B.dark
              : shot.clip === "overview"
                ? B.green
                : "#f0ecff",
            color: isReceipt || shot.clip === "overview" ? B.paper : "#6a49d2",
            borderRadius: 99,
            fontWeight: 700,
            letterSpacing: 0.3,
          }}
        >
          {shot.badge}
        </span>
        <span style={{ color: B.muted }}>0{clips.indexOf(shot) + 1} / 04</span>
      </div>
      {isReceipt && (
        <span
          style={{
            position: "absolute",
            bottom: portrait ? 50 : 17,
            left: pad,
            fontSize: portrait ? 19 : 15,
            color: B.muted,
          }}
        >
          A commitment to accounting; not proof of payment to an AI provider.
        </span>
      )}
    </AbsoluteFill>
  );
}

export function MetabolicPromo() {
  useBrandFont();
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ fontFamily: B.font, background: B.paper }}>
      <Html5Audio
        src={staticFile("films/assets/original-score.wav")}
        volume={Math.min(1, frame / 20, (PROMO_FRAMES - frame) / 30) * 0.72}
      />
      <Sequence from={0} durationInFrames={90}>
        <Intro />
      </Sequence>
      {clips.map((shot) => (
        <Sequence
          key={shot.clip}
          from={shot.start}
          durationInFrames={shot.duration}
        >
          <AppShot shot={shot} />
        </Sequence>
      ))}
      <Sequence from={780} durationInFrames={120}>
        <Intro ending />
      </Sequence>
    </AbsoluteFill>
  );
}

/** A short, seekable motion graphic can also be rendered independently. */
export function MetabolicBrandLoop() {
  useBrandFont();
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const phase = Math.min(3, Math.floor(frame / (fps * 2)));
  const colors = [B.mint, "#f2a93b", "#f0525e", "#6c8cff"];
  return (
    <AbsoluteFill
      style={{ fontFamily: B.font, color: B.paper, background: B.dark }}
    >
      <div
        style={{ position: "absolute", width: width * 0.55, height, right: 0 }}
      >
        <MetabolicCore
          width={width * 0.55}
          height={height}
          color={colors[phase]}
        />
      </div>
      <div style={{ padding: width * 0.065, width: width * 0.57 }}>
        <div style={{ fontSize: 17, letterSpacing: 2, color: B.pale }}>
          METABOLIC AI / MOTION STUDY
        </div>
        <div
          style={{
            fontSize: width * 0.053,
            lineHeight: 1.12,
            letterSpacing: -width * 0.003,
            fontWeight: 800,
            marginTop: 65,
          }}
        >
          {
            [
              "Room to think.",
              "Spend with care.",
              "Protect the reserve.",
              "Find its feet.",
            ][phase]
          }
        </div>
        <div
          style={{
            color: colors[phase],
            fontSize: 27,
            marginTop: 30,
            fontWeight: 600,
          }}
        >
          {
            [
              "Healthy → Premium",
              "Defensive → Standard",
              "Survival → costly work pauses",
              "Recovery → gradual return",
            ][phase]
          }
        </div>
        <div style={{ fontSize: 16, color: B.pale, marginTop: 45 }}>
          Illustrative state transitions · not a live economy
        </div>
      </div>
    </AbsoluteFill>
  );
}
