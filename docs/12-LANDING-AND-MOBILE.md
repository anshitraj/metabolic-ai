# Landing page and mobile experience

The landing page uses the existing Living Ledger design language: Newsreader
display type, warm paper, green accents and a dark Three.js specimen stage.
The Meridian and Sheltered references informed the interactive explanations,
controlled playback and tactile dashboard presentation. Their artwork, products
and economic claims are not copied.

## Interactive explanations

- The product walkthrough shows a deposit, an answer, a cost spike and a receipt.
  A shared timeline drives its cursor, click feedback, progress and displayed state.
- Visitors can select a step, pause, resume or replay. Playback suspends when the
  example leaves the viewport or the document is hidden.
- Reduced effects starts playback paused. System reduced motion also hides the
  animated cursor. Every example remains usable through real buttons.
- The Spend Pass example demonstrates a total allowance, a request cap, exhaustion
  and revocation. Its state lives only in the browser. It sends no requests to paid
  providers and never modifies keys, credits, wallet transactions or the ledger.
- The terminal walkthrough shows console settings, a real inference endpoint,
  illustrative accounting and a revoked-pass outcome. Every example is labelled.
- Local provider assets identify Gemini, Claude, DeepSeek, Llama and OpenAI.
  Connection status comes from public configuration. OpenAI is labelled as not
  integrated; a configured credential does not imply successful model access.
- FAQs distinguish model access, business states, server-enforced Spend Pass
  permissions and NEAR accounting commitments.

## Mobile application changes

- Persistent quick navigation for Overview, Workspace, Stress Lab and Treasury,
  with device safe-area padding and matching content clearance.
- Full navigation drawer has an explicit close button, Escape handling, focus
  containment, focus restoration, background inertness and scroll locking.
- Workspace conversation history, new conversations and request/session details
  remain accessible below the desktop breakpoint.
- Text inputs use phone-friendly sizing; the composer can shrink within the screen.
- Notifications fit within the viewport, cards can shrink inside grids, receipt
  identifiers wrap, timeline markers stay inside their chart, and chart gestures
  permit vertical scrolling.
- Onboarding actions stack beneath their descriptions on phones.
- The 3D stage has a proportional SVG fallback when WebGL is unavailable.

## Validation

The browser audit checks 12 pages at each of 360px, 390px and 768px (36 checks),
with no document overflow or page errors. Separate interaction checks cover
cursor/typing pause, resume, replay, manual steps, offscreen suspension, reduced
motion, mobile navigation, 3D state previews and the Spend Pass example. The
homepage examples make no paid API calls. Glossary placement is also checked on
a 360px viewport.

Production build, TypeScript and ESLint pass. Browser evidence and the
viewport/interaction reports are kept locally under
`artifacts/ux-polish/landing-redesign/` (ignored by Git).

The build also runs `scripts/sanitize-standalone.mjs`. Next's instrumentation
trace can include local PGlite files even when route tracing exclusions are set.
The guard removes private local data/environment references and copies from
standalone output, verifies path containment before removal, and preserves the
original developer data. Fixture checks cover preservation, trace filtering,
traversal rejection and idempotence. Deployment secrets belong in runtime
environment variables.

This UI work does not constitute a public deployment or a production
verification of treasury, database or signing configuration.
