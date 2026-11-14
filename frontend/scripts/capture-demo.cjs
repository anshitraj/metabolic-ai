/* eslint-disable @typescript-eslint/no-require-imports -- Playwright's script runner executes CommonJS. */
// Run from frontend through Playwright (or the installed Playwright skill runner).
const { chromium, expect } = require("playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const FRONT = path.resolve(
  process.env.METABOLIC_FRONTEND || path.join(__dirname, ".."),
);
if (!fs.existsSync(path.join(FRONT, "app", "console", "page.tsx")))
  throw new Error("Set METABOLIC_FRONTEND to the application folder.");
const BASE = process.env.DEMO_BASE_URL || "http://localhost:3002";
const RECEIPT = process.env.DEMO_RECEIPT_ID || "rcpt_20261114_132223_abd8ab1f";
const OUT = path.join(FRONT, "public", "films", "assets");
const RAW = path.join(FRONT, ".data", "motion-capture");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

async function pointer(page) {
  await page.addStyleTag({
    content:
      "nextjs-portal{display:none!important}html{scroll-behavior:auto!important}",
  });
  await page.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.id = "capture-cursor";
    cursor.style.cssText =
      "position:fixed;left:0;top:0;width:30px;height:36px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 2px 3px #0004);transform:translate(-100px,-100px)";
    cursor.innerHTML =
      '<svg viewBox="0 0 27 32"><path d="M3 2 23 20l-10 1-4 8Z" fill="#06301f" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cursor);
    window.addEventListener("mousemove", (e) => {
      cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
    });
    window.addEventListener("mousedown", (e) => {
      const ring = document.createElement("span");
      ring.style.cssText = `position:fixed;left:${e.clientX - 25}px;top:${e.clientY - 25}px;width:50px;height:50px;border:3px solid #12b36e;border-radius:50%;pointer-events:none;z-index:2147483646`;
      document.body.appendChild(ring);
      const animation = ring.animate(
        [
          { transform: "scale(.3)", opacity: 1 },
          { transform: "scale(1.5)", opacity: 0 },
        ],
        { duration: 650 },
      );
      animation.onfinish = () => ring.remove();
    });
  });
}
async function click(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 12,
  });
  await page.waitForTimeout(350);
  await locator.click();
}
async function focusResponse(page) {
  await page
    .getByText("2 · Understand the response", { exact: true })
    .evaluate((element) =>
      window.scrollTo({
        top: window.scrollY + element.getBoundingClientRect().top - 76,
        behavior: "smooth",
      }),
    );
  await page.waitForTimeout(650);
  await page.mouse.move(240, 150, { steps: 8 });
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ["--use-angle=swiftshader", "--enable-webgl"],
  });
  const manifest = {
    capturedAt: new Date().toISOString(),
    base: BASE,
    receiptId: RECEIPT,
    claims:
      "Actual app UI; Stress Lab is an isolated simulation; receipt is a real finalized testnet commitment.",
    formats: [],
  };
  try {
    for (const format of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 430, height: 550 },
    ]) {
      const ratio = 1;
      const context = await browser.newContext({
        viewport: { width: format.width, height: format.height },
        deviceScaleFactor: ratio,
        reducedMotion: "no-preference",
        recordVideo: {
          dir: RAW,
          size: { width: format.width * ratio, height: format.height * ratio },
        },
      });
      await context.addInitScript(() => {
        localStorage.setItem("metabolic:journey-collapsed", "1");
        localStorage.setItem("metabolic:reduced-effects", "0");
      });
      // Recording starts during newPage(), before that promise resolves.
      const origin = Date.now();
      const page = await context.newPage();
      const segments = [];
      const markerColors = [[240, 0, 240], [0, 240, 240], [240, 240, 0], [240, 0, 0]];
      const mark = async (name, duration) => {
        const color = markerColors[segments.length];
        await page.evaluate((rgb) => { const marker = document.createElement("div"); marker.id = "capture-sync"; marker.style.cssText = `position:fixed;left:0;top:0;width:32px;height:32px;z-index:2147483647;background:rgb(${rgb.join(",")});pointer-events:none`; document.body.appendChild(marker); }, color);
        await page.waitForTimeout(500);
        await page.evaluate(() => document.getElementById("capture-sync").remove());
        segments.push({ name, start: (Date.now() - origin) / 1000, duration, markerColor: color, wallStart: Date.now(), actionSeconds: 0 });
      };
      await page.goto(BASE + "/console", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await expect(page.getByText(/policy v/).first()).toBeVisible({
        timeout: 30000,
      });
      await page.locator(".m-stage canvas").waitFor({ timeout: 45000 });
      await page.evaluate(() => document.fonts.ready);
      await pointer(page);
      await page.evaluate(
        (mobile) => scrollTo(0, mobile ? 440 : 190),
        format.name === "mobile",
      );
      await page.waitForTimeout(1000);
      await mark("overview", 5);
      await page.mouse.move(format.width * 0.4, format.height * 0.65, {
        steps: 18,
      });
      await page.waitForTimeout(5000);

      await page.goto(BASE + "/console/stress-lab", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      const costs = page.getByRole("button", { name: /Costs rise/ });
      await expect(costs).toBeEnabled({ timeout: 30000 });
      await pointer(page);
      if (format.name === "desktop")
        await page.evaluate(() => scrollTo(0, 120));
      else await costs.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await mark("stress", 6);
      const spikeResponse = page.waitForResponse(
        (r) =>
          r.url().includes("/api/simulations/") &&
          r.request().method() === "POST",
      );
      await click(page, costs);
      const spike = await (await spikeResponse).json();
      expect(spike.modifiers.costMultiplier).toBe(3);
      segments.at(-1).actionSeconds = (Date.now() - segments.at(-1).wallStart) / 1000;
      if (format.name === "mobile") await focusResponse(page);
      await page.waitForTimeout(5000);

      const low = page.getByRole("button", { name: /Funds run low/ });
      await expect(low).toBeEnabled();
      await low.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await mark("survival", 6);
      const drainResponse = page.waitForResponse(
        (r) =>
          r.url().includes("/api/simulations/") &&
          r.request().method() === "POST",
      );
      await click(page, low);
      const drained = await (await drainResponse).json();
      expect(drained.overview.state).toBe("SURVIVAL");
      segments.at(-1).actionSeconds = (Date.now() - segments.at(-1).wallStart) / 1000;
      if (format.name === "mobile") await focusResponse(page);
      // Recovery is shown in the motion study; don't invent a completed recovery
      // while the policy's real dwell timer is still running.
      await page.waitForTimeout(5000);

      await page.goto(BASE + "/verify?id=" + encodeURIComponent(RECEIPT), {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await expect(page.getByText(/Match/).first()).toBeVisible({
        timeout: 45000,
      });
      await pointer(page);
      await page.evaluate(
        (mobile) => scrollTo(0, mobile ? 430 : 145),
        format.name === "mobile",
      );
      await page.waitForTimeout(400);
      await mark("receipt", 6);
      await page.mouse.move(format.width * 0.67, format.height * 0.45, {
        steps: 24,
      });
      await page.waitForTimeout(6000);
      const video = page.video();
      await context.close();
      const rawFile = await video.path();
      // Align to frames actually recorded, not to assumptions about browser startup.
      // The small synchronization patches are removed from every exported clip.
      const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "json", rawFile], { windowsHide: true }).toString());
      const [rateN, rateD] = probe.streams[0].r_frame_rate.split("/").map(Number);
      const captureFps = rateN / rateD;
      const pixels = execFileSync("ffmpeg", ["-v", "error", "-i", rawFile, "-vf", "crop=2:2:8:8,format=rgb24", "-vsync", "0", "-f", "rawvideo", "pipe:1"], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
      for (const segment of segments) {
        let lastMarker = -1;
        for (let frame = 0; frame * 12 < pixels.length; frame++) {
          const offset = frame * 12;
          if (segment.markerColor.every((value, channel) => Math.abs(value - pixels[offset + channel]) < 45)) lastMarker = frame;
        }
        if (lastMarker < 0) throw new Error(`Missing capture synchronization marker: ${segment.name}`);
        segment.videoStart = (lastMarker + 1) / captureFps + Math.max(0, segment.actionSeconds - 1.2);
        const destination = path.join(
          OUT,
          `${segment.name}-${format.name}.mp4`,
        );
        execFileSync(
          "ffmpeg",
          [
            "-y",
            "-ss",
            String(segment.videoStart),
            "-i",
            rawFile,
            "-t",
            String(segment.duration),
            "-an",
            "-c:v",
            "libx264",
            "-vf",
            "fps=30",
            "-crf",
            "16",
            "-preset",
            "fast",
            "-movflags",
            "+faststart",
            "-pix_fmt",
            "yuv420p",
            destination,
          ],
          { stdio: "pipe", windowsHide: true },
        );
      }
      manifest.formats.push({ ...format, segments });
      fs.writeFileSync(
        path.join(OUT, "capture-manifest.json"),
        JSON.stringify(manifest, null, 2),
      );
      console.log(
        `Captured ${format.name}: ${segments.map((s) => s.name).join(", ")}`,
      );
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
