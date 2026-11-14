import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const within = (root, target) => target.startsWith(root + path.sep);

/** Next's route trace exclusions do not cover its instrumentation trace.
 * Remove developer runtime state from both the trace and the copied bundle.
 * This never deletes the project's original .data or environment files.
 */
export function sanitizeStandalone(project, outputDirectory = ".next") {
  const root = realpathSync(project);
  const output = path.resolve(root, outputDirectory);
  if (!within(root, output)) throw new Error("Build output must be inside the project.");
  const standalone = realpathSync(path.join(output, "standalone"));
  if (!within(output, standalone)) throw new Error("Standalone output must stay inside the build directory.");
  const runtimeData = path.join(root, ".data");
  const privateSource = (file) => file === runtimeData || within(runtimeData, file)
    || (path.dirname(file) === root && /^\.env(?:\.|$)/.test(path.basename(file)));
  let removedTraceEntries = 0;
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".nft.json")) {
        const trace = JSON.parse(readFileSync(file, "utf8"));
        const kept = trace.files.filter((item) => !privateSource(path.resolve(directory, item)));
        if (kept.length !== trace.files.length) {
          removedTraceEntries += trace.files.length - kept.length;
          writeFileSync(file, JSON.stringify({ ...trace, files: kept }));
        }
      }
    }
  }
  // Scope to server metadata, without traversing the copied dependencies.
  walk(path.join(output, "server"));
  const privateCopies = readdirSync(standalone).filter((name) => name === ".data" || /^\.env(?:\.|$)/.test(name));
  for (const name of privateCopies) {
    const target = path.resolve(standalone, name);
    // Verify the absolute and resolved target before any recursive removal.
    if (!within(standalone, target) || !within(standalone, realpathSync(target))) {
      throw new Error("Refusing to remove a path outside the standalone bundle.");
    }
    rmSync(target, { recursive: true, force: true });
  }
  if (existsSync(path.join(standalone, ".data")) || readdirSync(standalone).some((name) => /^\.env(?:\.|$)/.test(name))) {
    throw new Error("Private runtime files remain in standalone output.");
  }
  return { removedTraceEntries, removedPrivateCopies: privateCopies.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = sanitizeStandalone(projectRoot, process.env.NEXT_DIST_DIR ?? ".next");
  console.log("[build] Standalone privacy check passed:", result);
}
