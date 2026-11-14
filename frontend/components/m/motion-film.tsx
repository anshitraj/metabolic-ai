"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import { MetabolicBrandLoop } from "@/remotion/MetabolicPromo";

export default function MotionFilm() {
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerRef>(null);
  const visible = useInView(ref, { amount: 0.2 });
  useEffect(() => {
    if (!visible) player.current?.pause();
  }, [visible]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) player.current?.pause();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  return (
    <div ref={ref} className="ml-film-player" data-testid="motion-film">
      {started ? (
        <Player
          ref={player}
          component={MetabolicBrandLoop}
          durationInFrames={240}
          compositionWidth={1200}
          compositionHeight={680}
          fps={30}
          style={{ width: "100%" }}
          controls
          autoPlay
          loop
          showVolumeControls={false}
          numberOfSharedAudioTags={0}
          aria-label="Metabolic AI motion study"
        />
      ) : (
        <div className="ml-film-placeholder">
          <div>
            <div className="mb-6 text-[11px] font-semibold uppercase tracking-[.14em] text-g-200">
              One organism. Four financial states.
            </div>
            <strong>
              See its survival
              <br />
              instinct in motion.
            </strong>
            <br />
            <button type="button" onClick={() => setStarted(true)}>
              ▷ Play the motion study
            </button>
            <p className="mt-4 text-[11px] text-g-200">
              8-second illustration · playback starts when you choose
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
