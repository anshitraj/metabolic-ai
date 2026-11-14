// Starts Metabolic AI's background jobs inside the Node.js server process.
// Set WORKER_INLINE=false to disable (e.g. when running `pnpm worker` separately
// against PostgreSQL, or during `next build`).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.WORKER_INLINE === "false") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startWorker } = await import("./server/worker");
  startWorker();
}
