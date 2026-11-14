# Simulation feedback and landing motion

The Stress Lab uses the real policy engine in an isolated economy. A cost spike
can change the chosen model while the business remains in Abundance. The response
card now explains that result and shows the starting model, current model, tier,
and router explanation together. It also distinguishes Survival caused by low
funds from Survival caused by losses. Pending recovery checks show their remaining
time. **Advance 1 min** runs six ten-second ticks with the current conditions.

Two engine defects were reproduced with failing integration tests and corrected:

- Sub-tick elapsed time was discarded on every refresh. The clock now carries the
  remainder forward, so frequent refreshes do not freeze simulated time.
- Simulation expense buckets included overhead in the compute margin, and the
  policy's runway calculation added overhead again. Provider cost is now separated
  from fixed overhead, matching real-economy snapshots. Total outflow still includes
  both. Existing scenario buckets remain readable.

The stage now labels its request window as **5 min** in the lab; the real overview
continues to use an hourly window. No simulation action changes customer balances.

## Walkthrough and motion

The landing walkthrough previously displayed a 12% Premium margin before its cost
action ran, while Premium remained selected. Its example pricing is now shared
with the Konva diagram: with customer prices fixed, 50% margin becomes **−20%**
when provider cost rises 2.4×. The illustrative Standard model retains 44% and is
selected. The receipt step preserves that selection. All figures remain labelled
as illustrations rather than catalog quotes.

The Fieldwork visual direction now includes provider logos, small coin/chat/shield/
receipt scenes, model-selection transitions, a smoother transform-based cursor,
and a native CSS reading-progress line. IntersectionObserver reveals content as
it enters the viewport. No scroll handler rewrites page position. Reduced motion
keeps content visible and turns off walkthrough autoplay.

The immediate SVG organism stays visible until Three.js renders its first frame.
The scene mounts near the viewport. Phones start with 7,000 core points rather
than 16,000, pixel ratio 1, and no bloom. Desktop post-processing loads separately.
Offscreen scenes stop rendering. Canvas event containers explicitly permit
vertical touch gestures; changing only the canvas itself was insufficient because
OrbitControls writes `touch-action: none` on its container.

Visual references reviewed on 15 November 2026: [Lovable](https://lovable.dev/),
[Claude](https://claude.com/), [Meridian](https://www.tradeonmeridian.xyz/), and
[Sheltered](https://sheltered.app/). The implementation retains Metabolic's own
layout, typography and product narrative.

Local evidence, screenshots and browser results are under
`artifacts/stress-debug/`. Production build, ESLint, economics tests, full-page
mobile scroll, delayed-chunk fallback, reduced motion and the complete simulation
action sequence are checked before delivery.
