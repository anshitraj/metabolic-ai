import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireApp = createRequire(path.join(FRONT, "package.json"));
let requireTools = requireApp;
let bundle, renderer;
try {
  ({ bundle } = requireTools("@remotion/bundler"));
  renderer = requireTools("@remotion/renderer");
} catch {
  // Optional Windows fallback for workspaces on filesystems without hardlinks.
  const toolkit = process.env.METABOLIC_RENDER_TOOLS;
  if (!toolkit)
    throw new Error(
      "Install the Remotion dev dependencies, or set METABOLIC_RENDER_TOOLS to a local toolkit containing the same versions.",
    );
  requireTools = createRequire(path.join(toolkit, "package.json"));
  ({ bundle } = requireTools("@remotion/bundler"));
  renderer = requireTools("@remotion/renderer");
}
const output = path.resolve(
  FRONT,
  "..",
  "artifacts",
  "motion-upgrade",
  "exports",
);
const bundleDir = path.join(FRONT, ".data", "remotion-bundle");
fs.mkdirSync(output, { recursive: true });
const requested = (
  process.argv.find((arg) => arg.startsWith("--formats="))?.split("=")[1] ??
  "wide,square,vertical"
).split(",");
const concurrency = Number(process.env.REMOTION_CONCURRENCY || 2);
const stillsOnly = process.argv.includes("--stills");
const skipPreviews = process.argv.includes("--no-previews");
const frameArgument = process.argv
  .find((arg) => arg.startsWith("--frames="))
  ?.split("=")[1];
const formats = {
  wide: "Metabolic-Wide",
  square: "Metabolic-Square",
  vertical: "Metabolic-Vertical",
  loop: "Metabolic-Brand-Loop",
};
for (const format of requested)
  if (!formats[format]) throw new Error(`Unknown format: ${format}`);

const browserExecutable = process.env.REMOTION_CHROME_EXECUTABLE || undefined;
const chromiumOptions = { gl: "swangle" };
let lastBundle = -1;
const serveUrl = await bundle({
  entryPoint: path.join(FRONT, "remotion", "index.tsx"),
  publicDir: path.join(FRONT, "public"),
  outDir: bundleDir,
  onProgress: (progress) => {
    const bucket = Math.floor(progress / 25);
    if (bucket > lastBundle) {
      console.log(`Bundle ${bucket * 25}%`);
      lastBundle = bucket;
    }
  },
  webpackOverride: (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      modules: [
        path.join(FRONT, "node_modules"),
        path.join(
          path.dirname(requireTools.resolve("@remotion/bundler/package.json")),
          "..",
          "..",
        ),
        ...(config.resolve?.modules ?? []),
      ],
      alias: {
        ...config.resolve?.alias,
        react: path.dirname(requireApp.resolve("react/package.json")),
        "react-dom": path.dirname(requireApp.resolve("react-dom/package.json")),
        remotion: path.dirname(requireApp.resolve("remotion/package.json")),
      },
    },
  }),
});
const browser = await renderer.openBrowser("chrome", {
  browserExecutable,
  chromiumOptions,
});
try {
  const compositions = await renderer.getCompositions(serveUrl, {
    puppeteerInstance: browser,
    chromiumOptions,
  });
  const report = {
    renderedAt: new Date().toISOString(),
    remotionVersion: "4.0.543",
    fps: 30,
    files: fs.existsSync(path.join(output, "render-manifest.json")) ? JSON.parse(fs.readFileSync(path.join(output, "render-manifest.json"), "utf8")).files.filter((item) => !requested.includes(item.format)) : [],
    inspectedFrames: [],
    sound: "Original synthesized score; no third-party music or voices",
    source:
      "Actual application captures; simulated Stress Lab footage labelled",
  };
  for (const format of requested) {
    const composition = compositions.find(
      (item) => item.id === formats[format],
    );
    if (!composition) throw new Error(`Composition missing: ${format}`);
    const frames = skipPreviews
      ? []
      : frameArgument
        ? frameArgument.split(",").map(Number)
        : format === "loop"
          ? [45, 100, 160, 210]
          : format === "wide"
            ? [45, 120, 225, 300, 390, 480, 570, 660, 750, 825]
            : [45, 330, 690, 825];
    if (
      frames.some(
        (frame) =>
          !Number.isInteger(frame) ||
          frame < 0 ||
          frame >= composition.durationInFrames,
      )
    )
      throw new Error("Preview frame is outside the composition.");
    for (const frame of frames) {
      const destination = path.join(
        output,
        `review-${format}-${String(frame).padStart(3, "0")}.png`,
      );
      await renderer.renderStill({
        composition,
        serveUrl,
        output: destination,
        frame,
        imageFormat: "png",
        puppeteerInstance: browser,
        chromiumOptions,
      });
      report.inspectedFrames.push({
        format,
        frame,
        seconds: frame / 30,
        file: path.basename(destination),
      });
      console.log(`Preview ${format}: frame ${frame}`);
    }
    if (!stillsOnly) {
      const destination = path.join(output, `metabolic-${format}.mp4`);
      let lastProgress = -1;
      await renderer.renderMedia({
        composition,
        serveUrl,
        outputLocation: destination,
        codec: "h264",
        crf: 18,
        pixelFormat: "yuv420p",
        audioCodec: "aac",
        audioBitrate: "192k",
        imageFormat: "png",
        concurrency,
        offthreadVideoCacheSizeInBytes: 268435456,
        puppeteerInstance: browser,
        chromiumOptions,
        onProgress: ({ progress, renderedFrames }) => {
          const bucket = Math.floor(progress * 10);
          if (bucket > lastProgress) {
            console.log(
              `${format}: ${bucket * 10}% (${renderedFrames} frames)`,
            );
            lastProgress = bucket;
          }
        },
      });
      report.files.push({
        format,
        file: path.basename(destination),
        width: composition.width,
        height: composition.height,
        durationSeconds: composition.durationInFrames / composition.fps,
        bytes: fs.statSync(destination).size,
      });
      console.log(`Rendered ${format}.`);
    }
    fs.writeFileSync(
      path.join(
        output,
        stillsOnly ? "preview-manifest.json" : "render-manifest.json",
      ),
      JSON.stringify(report, null, 2),
    );
  }
} finally {
  await browser.close({ silent: true });
}
