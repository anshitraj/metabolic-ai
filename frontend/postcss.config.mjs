import path from "node:path";

// Turbopack resolves plugin names from its own chunk directory, so a local plugin
// needs an absolute path. `next dev` / `next build` run with the project root as cwd.
const stripRemoteImport = path.join(process.cwd(), "postcss", "strip-remote-import.cjs");

const config = {
  plugins: {
    // Must run before Tailwind so remote @imports never reach the bundle.
    [stripRemoteImport]: {},
    "@tailwindcss/postcss": {},
  },
};

export default config;
