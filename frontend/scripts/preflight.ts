import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
// Runtime env wins. TESTNET_ENV_FILE is an explicit local testnet overlay.
if (existsSync(".env.local")) for (const [key, value] of Object.entries(parseEnv(readFileSync(".env.local", "utf8")))) process.env[key] ??= value;
if (process.env.TESTNET_ENV_FILE) Object.assign(process.env, parseEnv(readFileSync(process.env.TESTNET_ENV_FILE, "utf8")));
const { deploymentReadiness } = await import("../server/services/readiness");
const result = await deploymentReadiness();
console.log(JSON.stringify(result, null, 2));
process.exit(result.ready ? 0 : 1);
