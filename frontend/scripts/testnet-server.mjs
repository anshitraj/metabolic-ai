import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
const local = parseEnv(readFileSync(".env.local", "utf8"));
const demo = parseEnv(readFileSync(".data/testnet-demo.env", "utf8"));
if (demo.NEAR_NETWORK !== "testnet" || demo.NEAR_RPC_URL !== "https://rpc.testnet.near.org") throw new Error("Only the prepared testnet environment may run here.");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", "3002"], { env: { ...process.env, ...local, ...demo }, stdio: "inherit", windowsHide: true });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
