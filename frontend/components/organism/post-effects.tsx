"use client";

import { Bloom, EffectComposer } from "@react-three/postprocessing";

export default function PostEffects({ intensity }: { intensity: number }) {
  return <EffectComposer multisampling={0}><Bloom intensity={intensity} luminanceThreshold={0.32} luminanceSmoothing={0.4} mipmapBlur radius={0.7} /></EffectComposer>;
}
