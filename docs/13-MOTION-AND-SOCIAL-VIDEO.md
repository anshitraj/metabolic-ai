# Motion, word art and the social demo

The current visual direction is **Fieldwork**: a bold Manrope wordmark, rounded
operational cards, a clear hierarchy, restrained green and a physical 3D core.
Kite informed the typography only. The product, copy, logo geometry, dashboard
and motion remain Metabolic's own.

## Application

- The landing page has bold word art, a geometric cell mark, an animated underline,
  physical Three.js geometry and the existing live economic organism.
- The Konva routing playground shows an illustrative request path and lets visitors
  inspect tiers and raise example costs. Its HTML controls and explanations remain
  keyboard accessible. Its animation pauses offscreen and respects reduced effects.
- The Remotion player provides an eight-second, frame-driven state study. It loads
  near the viewport and plays only after the visitor chooses Play. Leaving the
  viewport or hiding the document pauses it. The silent study allocates no shared
  audio tags, so its helper audio does not conflict with the production CSP.
- Navigation, page titles, cards, metric hierarchy, onboarding, input sizes and
  mobile transaction views use the same visual system inside the console.
- Returned customers with a completed setup get a collapsed guide by default.
  Explicit guide preferences are preserved. Long provider lists wrap inside cards.
- The 3D canvas permits vertical touch scrolling and avoids wheel zoom trapping.

## Demo film

The editable source is in `frontend/remotion/`. All video motion is calculated
from Remotion's frame; the Three.js scene uses `ThreeCanvas`, with frame-derived
transforms rather than a free-running render clock.

The 30-second film has six shots:

| Time | Shot | Source |
|---|---|---|
| 0–3s | Built to think. Smart enough to survive. | Original word art and 3D scene |
| 3–8s | Meet the business | Actual local testnet overview |
| 8–14s | Costs rise | Actual isolated Stress Lab interaction |
| 14–20s | Protect the reserve | Actual simulated drain, with a checked Survival result |
| 20–26s | Verify the record | Actual finalized testnet receipt, independently checked in the browser |
| 26–30s | Explore the code | Original word art, 3D and the public repository URL |

The simulation badge stays visible. The receipt is a commitment to accounting;
it does not prove payment to an AI provider. No wallet transaction or paid AI
request is made to capture these scenes. The local testnet app is not a public
production deployment.

The soundtrack is original synthesized audio. The Manrope font is distributed
with its OFL license in `frontend/public/fonts/`. Existing provider SVGs retain
their adjacent MIT license and attribution.

## Reproduction

From `frontend`, install the declared dependencies and Chromium if needed:

```powershell
pnpm install
pnpm exec playwright install chromium
```

Keep the prepared testnet app running on port 3002, then capture or reuse the
included clips:

```powershell
node scripts/capture-demo.cjs
pnpm video:preview --formats=wide,square,vertical
pnpm video:render --formats=wide,square,vertical
pnpm video:studio
```

For a different running service, set `DEMO_BASE_URL` and `DEMO_RECEIPT_ID`. The
capture script refuses to proceed without a matching receipt or the expected
simulated action results. Transient color markers align the cuts to recorded
frames and are trimmed from every final clip. Source clips are normalized to
30 fps H.264 for reliable seeking.

The script accepts `--formats=wide`, `--formats=square`, `--formats=vertical`,
`--stills`, `--frames=45,330,690` and `--no-previews`. `REMOTION_CONCURRENCY=1`
reduces peak rendering load. Each render uses a bounded video frame cache.
If a Windows workspace cannot install packages that require hardlinks, a normal
local Remotion installation can be selected with `METABOLIC_RENDER_TOOLS`.
`REMOTION_CHROME_EXECUTABLE` can select an existing Chrome executable.

The local delivery folder is `artifacts/motion-upgrade/exports/`. It contains the
MP4 cuts, subtitles, social caption, posters and verification reports. Raw
recordings and build bundles stay under ignored `.data/`.

## Validation

The browser audit covers 53 route/viewport combinations, including 320px landing,
360px and 390px console layouts, tablet and desktop. It records no document
overflow, page exceptions or console errors. Additional checks cover the Konva
controls, Remotion playback, mobile conversation access, drawer Escape handling,
and real testnet receipt matching.

Build, TypeScript and ESLint are checked separately. Video QA includes rendered
frames, action/result alignment, transition-boundary frames, native browser
seeking, full-file decoding, audio presence and codec/dimension metadata.

The final production browser check records no page exceptions, console errors or
failed assets while exercising the Konva controls, Remotion playback and native
MP4 playback. All three 30-second exports decode without errors. They use H.264
video at 30 fps and stereo AAC at 48 kHz. The original audio mix peaks at about
-10.4 dBFS. The social ZIP contains only the three final cuts, cover, caption,
subtitles and delivery notes; verification reports remain alongside it.
