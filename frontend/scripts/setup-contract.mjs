#!/usr/bin/env node
// One-command setup for on-chain receipts. No NEAR CLI needed.
//
//   pnpm setup:contract <your-account.testnet> [--name metabolic] [--fund 3] [--yes] [--dry]
//
// What it does (all on NEAR testnet, from YOUR account):
//   1. creates  <name>.<your-account>  and funds it (default 3 NEAR, most of it stays as treasury)
//   2. deploys the metabolic contract to it and initialises it with you as owner
//   3. lets the contract account commit receipts, using a limited key the server will hold
//      (a function-call key that can ONLY call commit_receipt and has a small gas allowance)
//   4. writes NEAR_CONTRACT_ID / NEAR_RECEIPT_SIGNER_ID / NEAR_RECEIPT_SIGNER_KEY into .env.local
//
// Your account's private key is read from the NEAR_OPERATOR_KEY environment variable or a
// hidden prompt. It is used to sign one transaction and one call, and is never written to disk.
// Export it from your wallet: MyNearWallet → Settings → Security & Recovery → Export private key.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { Account } from "@near-js/accounts";
import { KeyPair, PublicKey } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators, createTransaction, encodeTransaction } from "@near-js/transactions";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const WASM = path.resolve(root, "..", "contracts", "metabolic", "target", "wasm32-unknown-unknown", "release", "metabolic.wasm");
const ENV_FILE = path.join(root, ".env.local");
const RPC = process.env.NEAR_RPC_URL || "https://rpc.testnet.near.org";
const YOCTO = 10n ** 24n;

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const operator = args.find((a) => !a.startsWith("--") && !(args[args.indexOf(a) - 1] ?? "").startsWith("--"));
const fail = (m) => {
  console.error(`\n✖ ${m}\n`);
  process.exit(1);
};
const say = (m = "") => console.log(m);

if (!operator) fail("Usage: pnpm setup:contract <your-account.testnet> [--name metabolic] [--fund 3] [--yes] [--dry]");
if (!/^[a-z\d][a-z\d._-]*\.testnet$/.test(operator)) fail("This script only deploys to NEAR testnet; the account must end in .testnet.");
if (!/^[a-z\d]([a-z\d_-]*[a-z\d])?$/.test(opt("name", "metabolic"))) fail("--name may contain lowercase letters, digits, - and _ only.");
if (!existsSync(WASM)) fail(`Contract not built. Run:\n  cd ../contracts/metabolic && cargo build --target wasm32-unknown-unknown --release\nexpected: ${WASM}`);

const contractId = `${opt("name", "metabolic")}.${operator}`;
const fundNear = Number(opt("fund", "3"));
if (!Number.isFinite(fundNear) || fundNear < 2 || fundNear > 50) fail("--fund must be between 2 and 50 NEAR (the contract needs ~2 NEAR for its code).");
const fund = BigInt(Math.round(fundNear * 1e6)) * (YOCTO / 1_000_000n);
const wasm = new Uint8Array(readFileSync(WASM));

async function hiddenPrompt(q) {
  if (!process.stdin.isTTY) fail("No terminal to prompt on. Set NEAR_OPERATOR_KEY in the environment instead.");
  process.stdout.write(q);
  return new Promise((resolve) => {
    let s = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const on = (c) => {
      for (const ch of c) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", on);
          process.stdout.write("\n");
          return resolve(s);
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f" || ch === "\b") s = s.slice(0, -1);
        else s += ch;
      }
    };
    process.stdin.on("data", on);
  });
}

async function confirm(q) {
  if (flag("yes")) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(q, r));
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "s", method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.cause?.name ?? j.error.message), { rpc: j.error });
  return j.result;
}
const viewAccount = (id) => rpc("query", { request_type: "view_account", finality: "final", account_id: id }).catch(() => null);

function upsertEnv(vars) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  for (const [k, v] of Object.entries(vars)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  writeFileSync(ENV_FILE, text);
}

// ---------------------------------------------------------------- plan
const signer = KeyPair.fromRandom("ed25519"); // the server's receipt key (function-call only)
say(`\nMetabolic AI · on-chain receipts setup (NEAR testnet)\n`);
say(`  Your account:      ${operator}`);
say(`  Contract account:  ${contractId}   (will be created, funded with ${fundNear} NEAR from you)`);
say(`  Contract code:     ${(wasm.length / 1024).toFixed(0)} KB, owner = ${operator}`);
say(`  Receipt key:       function-call only → commit_receipt on ${contractId}, 1 NEAR gas allowance\n`);

function buildActions(operatorPublicKey) {
  return [
    actionCreators.createAccount(),
    actionCreators.transfer(fund),
    actionCreators.addKey(operatorPublicKey, actionCreators.fullAccessKey()), // you keep full control of the contract account
    actionCreators.addKey(signer.getPublicKey(), actionCreators.functionCallAccessKey(contractId, ["commit_receipt"], YOCTO)),
    actionCreators.deployContract(wasm),
    actionCreators.functionCall("new", { owner: operator }, 30_000_000_000_000n, 0n),
  ];
}

if (flag("dry")) {
  const pk = KeyPair.fromRandom("ed25519").getPublicKey();
  const tx = createTransaction(operator, pk, contractId, 1n, buildActions(pk), new Uint8Array(32));
  say(`Dry run: transaction encodes to ${encodeTransaction(tx).length} bytes with ${buildActions(pk).length} actions. Nothing was sent.`);
  process.exit(0);
}

// ---------------------------------------------------------------- go
const rawKey = (process.env.NEAR_OPERATOR_KEY || (await hiddenPrompt(`Private key for ${operator} (ed25519:…, input hidden): `))).trim();
let operatorKey;
try {
  operatorKey = KeyPair.fromString(rawKey);
} catch {
  fail("That is not a valid NEAR private key (it should look like ed25519:…).");
}
const operatorPub = operatorKey.getPublicKey().toString();

const acct = await viewAccount(operator);
if (!acct) fail(`${operator} does not exist on testnet.`);
const keyOk = await rpc("query", { request_type: "view_access_key", finality: "final", account_id: operator, public_key: operatorPub }).catch(() => null);
if (!keyOk) fail(`That private key is not an access key of ${operator}. Export the key for this exact account from your wallet.`);
if (keyOk.permission !== "FullAccess") fail("That key is not a full-access key, so it can't create accounts. Export the account's full-access key.");
const balance = BigInt(acct.amount);
if (balance < fund + YOCTO) fail(`${operator} has ${(Number(balance / 10n ** 20n) / 10000).toFixed(2)} NEAR; it needs at least ${fundNear + 1}. Get testnet NEAR from a faucet or lower --fund.`);
if (await viewAccount(contractId)) fail(`${contractId} already exists. Pick another name with --name, e.g. --name metabolic2.`);

if (!(await confirm(`Create and deploy now? This sends real transactions on testnet. [y/N] `))) fail("Cancelled. Nothing was sent.");

const provider = new JsonRpcProvider({ url: RPC });
const me = new Account(operator, provider, new KeyPairSigner(operatorKey));
say("\n1/3  Creating the account and deploying the contract…");
const out = await me.signAndSendTransaction({ receiverId: contractId, actions: buildActions(PublicKey.from(operatorPub)), waitUntil: "FINAL" });
if (typeof out.status === "object" && out.status && "Failure" in out.status) fail(`Deployment failed: ${JSON.stringify(out.status.Failure).slice(0, 400)}`);
say(`     ✓ ${out.transaction_outcome.id}`);

say("2/3  Allowing the contract account to commit receipts…");
const addSigner = await me.signAndSendTransaction({
  receiverId: contractId,
  actions: [actionCreators.functionCall("add_signer", { account_id: contractId }, 30_000_000_000_000n, 0n)],
  waitUntil: "FINAL",
});
if (typeof addSigner.status === "object" && addSigner.status && "Failure" in addSigner.status) fail(`add_signer failed: ${JSON.stringify(addSigner.status.Failure).slice(0, 400)}`);
say(`     ✓ ${addSigner.transaction_outcome.id}`);

say("3/3  Verifying the contract answers…");
const view = await rpc("query", { request_type: "call_function", finality: "final", account_id: contractId, method_name: "signers", args_base64: Buffer.from("{}").toString("base64") });
const signers = JSON.parse(Buffer.from(view.result).toString("utf8"));
if (!signers.includes(contractId)) fail("The contract is deployed but the receipt signer wasn't registered. Re-run add_signer manually (see contracts/metabolic/README.md).");
say(`     ✓ signers: ${signers.join(", ")}`);

upsertEnv({ NEAR_CONTRACT_ID: contractId, NEAR_RECEIPT_SIGNER_ID: contractId, NEAR_RECEIPT_SIGNER_KEY: signer.toString() });
say(`\n✔ Done. Wrote NEAR_CONTRACT_ID, NEAR_RECEIPT_SIGNER_ID and NEAR_RECEIPT_SIGNER_KEY to .env.local.`);
say(`  Restart the dev server, then open Receipts → "Publish receipt now".`);
say(`  Explorer: https://testnet.nearblocks.io/address/${contractId}`);
say(`\n  Note: with a contract configured, new deposits go to ${contractId} (via deposit()).`);
say(`  Funds already sent to your treasury account stay recorded as they were.\n`);
