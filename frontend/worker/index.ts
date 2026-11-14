// Standalone worker for PostgreSQL deployments:
//   WORKER_INLINE=false on the web app, then
//   DATABASE_URL=… pnpm worker
// Do not run this against the embedded PGlite database (single-process only).
import { startWorker } from "../server/worker";

if (!process.env.DATABASE_URL) {
  console.error("[worker] DATABASE_URL is required for a standalone worker (PGlite is single-process; use the inline worker instead).");
  process.exit(1);
}
startWorker();
// Keep the process alive; the job timer is unref'd.
setInterval(() => {}, 1 << 30);
